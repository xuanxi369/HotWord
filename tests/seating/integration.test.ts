import { afterEach, describe, expect, it, vi } from 'vitest';
import { testEnv } from '../support/database';
import { fetchApi } from '../../server/http';
import { analyzeSeating } from '../../server/seating';
import { buildRequest, invokeModel } from '../../server/providers';
import { modelDefaults } from '../../shared/models';
import { saveCredential } from '../../server/credentials';
import { buildRoster } from '../../shared/seating/roster';
import type { Plan } from '../../shared/seating/schema';
import { pageForPath } from '../../src/pages';

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=';
const sheets = [{ name: '名单', cells: [
  { address: 'A1', row: 1, column: 1, text: '张三' }, { address: 'A2', row: 2, column: 1, text: '张三' },
] }];
const plan = { summary: '合成分区', zones: [{ id: 'a', label: 'A区', position: '前排', rows: 1, columns: 2,
  direction: 'left-to-right', confidence: 'high', bbox: null, sources: [{ sheet: '名单', range: 'A1:A2', mode: 'grid', nameColumn: null, phoneColumn: null, organizationColumn: null, titleColumn: null }] }], ignoredCells: [], warnings: [] };
const input = { selection: { mode: 'team', serviceId: 'vision' }, image, sheets, notes: '' };
function setup() {
  const db = testEnv();
  db.env.TEAM_SERVICES = JSON.stringify([{ id: 'vision', name: '团队视觉', config: modelDefaults('openai') }]);
  return db;
}
function response(value: unknown = plan) {
  return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }], usage: { input_tokens: 100, output_tokens: 50 } });
}
afterEach(() => vi.unstubAllGlobals());

describe('HotWord seating integration', () => {
  it('uses the same route, authentication and origin protection', async () => {
    const { env, sqlite } = setup();
    const request = new Request('http://localhost/api/seating/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://other.example' }, body: JSON.stringify(input) });
    expect((await fetchApi(request, env)).status).toBe(403);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM admissions').get()).toMatchObject({ n: 0 });
    env.AUTH_MODE = 'access'; env.ACCESS_TEAM_DOMAIN = 'example.cloudflareaccess.com'; env.ACCESS_AUD = 'test';
    expect((await fetchApi(new Request('https://site.example/api/seating/analyze', { method: 'POST' }), env)).status).toBe(401);
    sqlite.close();
  });
  it('sends a real image, preserves duplicate source names, records usage and releases admission without storing files', async () => {
    const { env, sqlite, objects, starts } = setup();
    const fetcher = vi.fn(async (_url, init) => { const body = JSON.parse(init.body); expect(body.input[0].content[1].image_url).toBe(image); expect(body.text.format.name).toBe('seating_plan'); expect(body.store).toBe(false); return response(); });
    vi.stubGlobal('fetch', fetcher);
    const result = await analyzeSeating(env, 'local@development', input);
    expect(buildRoster(result.plan, sheets).people.map(person => [person.name, person.id])).toEqual([['张三', '名单!A1'], ['张三', '名单!A2']]);
    expect(sqlite.prepare('SELECT input_tokens,output_tokens,active FROM admissions').get()).toMatchObject({ input_tokens: 100, output_tokens: 50, active: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM ai_usage').get()).toMatchObject({ n: 1 });
    expect(objects.size).toBe(0); expect(starts).toHaveLength(0);
    sqlite.close();
  });
  it.each(['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'])('allows %s through the HTTP route and sends image content to DeepSeek', async model => {
    const { env, sqlite, objects, starts } = setup();
    const config = { ...modelDefaults('deepseek'), model };
    env.TEAM_SERVICES = JSON.stringify([{ id: 'vision', name: '团队 DeepSeek', config }]);
    const fetcher = vi.fn(async (url, init) => {
      expect(url).toBe('https://api.deepseek.com/chat/completions');
      expect(init.headers.Authorization).toBe('Bearer team-deepseek-key');
      const body = JSON.parse(init.body);
      expect(body).toMatchObject({ model, response_format: { type: 'json_object' }, thinking: { type: 'disabled' }, stream: false });
      expect(body.messages[1].content).toEqual([
        { type: 'text', text: JSON.stringify({ userNotes: '', sheets }) },
        { type: 'image_url', image_url: { url: image } },
      ]);
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(plan) } }], usage: { prompt_tokens: 100, completion_tokens: 50 } });
    });
    vi.stubGlobal('fetch', fetcher);
    try {
      const reply = await fetchApi(new Request('http://localhost/api/seating/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' }, body: JSON.stringify(input),
      }), env);
      expect(reply.status).toBe(200);
      const result = await reply.json() as { plan: Plan };
      expect(result).toMatchObject({ model, provider: '团队 DeepSeek', plan });
      expect(buildRoster(result.plan, sheets).people.map(person => person.id)).toEqual(['名单!A1', '名单!A2']);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(sqlite.prepare('SELECT input_tokens,output_tokens,active FROM admissions').get()).toMatchObject({ input_tokens: 100, output_tokens: 50, active: 0 });
      expect(sqlite.prepare('SELECT model,provider FROM ai_usage').get()).toMatchObject({ model, provider: 'deepseek' });
      expect(objects.size).toBe(0); expect(starts).toHaveLength(0);
    } finally { sqlite.close(); }
  });
  it('admits personal DeepSeek Flash image calls and consumes the one-time credential', async () => {
    const { env, sqlite } = setup();
    const credential = await saveCredential(env, 'local@development', { name: '个人 Flash', apiKey: 'personal-flash-key', config: modelDefaults('deepseek'), remember: false });
    const fetcher = vi.fn(async (_url, init) => {
      expect(init.headers.Authorization).toBe('Bearer personal-flash-key');
      expect(JSON.parse(init.body).messages[1].content[1].image_url.url).toBe(image);
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(plan) } }], usage: { prompt_tokens: 100, completion_tokens: 50 } });
    });
    vi.stubGlobal('fetch', fetcher);
    try {
      expect(await analyzeSeating(env, 'local@development', { ...input, selection: { mode: 'personal', credentialId: credential.id } })).toMatchObject({ model: 'deepseek-flash', plan });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(sqlite.prepare('SELECT COUNT(*) AS n FROM credentials').get()).toMatchObject({ n: 0 });
      expect(sqlite.prepare('SELECT mode,active FROM admissions').get()).toMatchObject({ mode: 'personal', active: 0 });
    } finally { sqlite.close(); }
  });
  it('rejects invalid source references and truncated output, releasing capacity and counting billed calls', async () => {
    const { env, sqlite } = setup();
    vi.stubGlobal('fetch', vi.fn(async () => response({ ...plan, zones: [{ ...plan.zones[0], sources: [{ ...plan.zones[0].sources[0], sheet: '编造的表' }] }] })));
    await expect(analyzeSeating(env, 'local@development', input)).rejects.toThrow('引用无效');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, usage: { input_tokens: 30, output_tokens: 40 } })));
    await expect(analyzeSeating(env, 'local@development', input)).rejects.toThrow('输出达到上限');
    expect(sqlite.prepare('SELECT SUM(active) AS active FROM admissions').get()).toMatchObject({ active: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM ai_usage').get()).toMatchObject({ n: 2 });
    sqlite.close();
  });
  it('enforces shared concurrency and validates data before consuming capacity', async () => {
    const { env, sqlite } = setup();
    await expect(analyzeSeating(env, 'local@development', { ...input, image: 'data:image/png;base64,YmFk' })).rejects.toThrow('格式与内容');
    await expect(analyzeSeating(env, 'local@development', { ...input, sheets: [{ ...sheets[0], cells: [...sheets[0].cells, sheets[0].cells[0]] }] })).rejects.toThrow('重复');
    for (let n = 0; n < 2; n++) sqlite.prepare('INSERT INTO admissions(id,owner,mode,created_at) VALUES(?,?,?,?)').run(`task${n}`, 'local@development', 'team', Date.now());
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(analyzeSeating(env, 'local@development', input)).rejects.toThrow('上限'); expect(fetcher).not.toHaveBeenCalled();
    sqlite.close();
  });
  it('uses owned encrypted credentials and consumes one-time credentials only on admission', async () => {
    const { env, sqlite } = setup();
    const credential = await saveCredential(env, 'local@development', { name: '个人视觉', apiKey: 'personal-test-key', config: modelDefaults('openai'), remember: false });
    const personal = { ...input, selection: { mode: 'personal', credentialId: credential.id } };
    await expect(analyzeSeating(env, 'other@example.com', personal)).rejects.toThrow();
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM credentials').get()).toMatchObject({ n: 1 });
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => { expect(init.headers.Authorization).toBe('Bearer personal-test-key'); return response(); }));
    await analyzeSeating(env, 'local@development', personal);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM credentials').get()).toMatchObject({ n: 0 });
    await expect(analyzeSeating(env, 'local@development', personal)).rejects.toThrow();
    sqlite.close();
  });
  it('builds each provider image protocol while retaining text calls', () => {
    const openai = buildRequest(modelDefaults('openai'), 'system', 'text'); expect(openai).toMatchObject({ input: 'text' });
    const claude = buildRequest(modelDefaults('claude'), 'system', 'text', undefined, false, { image }) as any;
    expect(claude.messages[0].content[0].source.media_type).toBe('image/png');
    for (const provider of ['qwen', 'zhipu', 'deepseek'] as const) {
      const request = buildRequest(modelDefaults(provider), 'system', 'text', undefined, false, { image }) as any;
      expect(request.messages[1].content[1].image_url.url).toBe(image);
    }
    const cf = buildRequest(modelDefaults('cloudflare', '@cf/meta/llama-3.2-11b-vision-instruct'), 'system', 'text', undefined, false, { image }) as any;
    expect(cf.image.slice(0, 4)).toEqual([137, 80, 78, 71]); expect(cf.prompt).toContain('system');
  });
  it('restores all three workspaces by URL', () => {
    expect(pageForPath('/')).toBe('conference'); expect(pageForPath('/multilingual/')).toBe('multilingual'); expect(pageForPath('/seating')).toBe('seating');
  });
  it('rejects known text models and oversized context before model admission', async () => {
    const { env, sqlite } = setup();
    env.TEAM_SERVICES = JSON.stringify([{ id: 'vision', name: '文本服务', config: modelDefaults('deepseek', 'deepseek-v4-pro') }]);
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(analyzeSeating(env, 'local@development', input)).rejects.toThrow('只支持文本');
    env.TEAM_SERVICES = JSON.stringify([{ id: 'vision', name: '小上下文', config: { ...modelDefaults('openai'), contextWindow: 12000 } }]);
    await expect(analyzeSeating(env, 'local@development', input)).rejects.toThrow('上下文');
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM admissions').get()).toMatchObject({ n: 0 });
    expect(fetcher).not.toHaveBeenCalled();
    sqlite.close();
  });
  it('uses the Cloudflare AI binding for images and aborts calls at their deadline', async () => {
    const { env, sqlite } = setup();
    let signal: AbortSignal | undefined;
    env.AI = { run: vi.fn(async (_model: string, body: any, options?: { signal: AbortSignal }) => { signal = options?.signal; expect(body.image.slice(0, 4)).toEqual([137, 80, 78, 71]); return { response: JSON.stringify(plan) }; }) } as any;
    const config = modelDefaults('cloudflare', '@cf/meta/llama-3.2-11b-vision-instruct');
    env.TEAM_SERVICES = JSON.stringify([{ id: 'vision', name: 'Workers 视觉', config }]);
    expect((await analyzeSeating(env, 'local@development', input)).model).toBe(config.model);
    expect(signal?.aborted).toBe(false);
    env.AI = { run: vi.fn(async (_model: string, _body: any, options: { signal: AbortSignal }) => { signal = options.signal; return new Promise(() => {}); }) } as any;
    await expect(invokeModel(env, config, '', 'system', 'text', undefined, false, { image, timeoutMs: 2 })).rejects.toThrow('超时');
    expect(signal?.aborted).toBe(true);
    sqlite.close();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createJob } from '../server/jobs';
import { saveCredential, taskKey } from '../server/credentials';
import { ExtractionWorkflow } from '../server/workflow';
import worker from '../server/index';
import { modelDefaults, type Provider } from '../shared/models';
import { compileTranslations } from '../shared/compiler';
import { bisectText } from '../shared/chunks';
import type { ExtractionResult } from '../shared/schema';
import { testEnv } from './support/database';
import { NonRetryableError } from './support/workflow-runtime';
import { recordUsage, releaseTask } from '../server/store';
import { settings } from '../server/models';

const text = 'Somnia-梦境公链，Industrial Collaboration-产业协同';
const result = { terms: [{ source: 'Somnia', target: '梦境公链', category: 'company', priority: 90, basis: 'source', evidence: text }, { source: 'Industrial Collaboration', target: '产业协同', category: 'industry', priority: 80, basis: 'source', evidence: text }] };
function reply(provider: Provider) {
  const content = JSON.stringify(result);
  if (provider === 'openai') return { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: content }] }], usage: { input_tokens: 100, output_tokens: 80 } };
  if (provider === 'claude') return { stop_reason: 'end_turn', content: [{ type: 'text', text: content }], usage: { input_tokens: 100, output_tokens: 80 } };
  return { choices: [{ finish_reason: 'stop', message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 80 } };
}
const owner = 'member@example.com';
async function run(env: ReturnType<typeof testEnv>['env'], id: string, wrapErrors = false) {
  const durableValues: unknown[] = [];
  const step = { async do(_name: string, options: any, work?: () => Promise<unknown>) {
    const fn = work ?? options, retries = work ? options.retries?.limit ?? 0 : 0;
    for (let attempt = 0; ; attempt++) {
      try { const value = await fn(); durableValues.push(value); return value; }
      catch (e) { if (e instanceof NonRetryableError || attempt >= retries) throw wrapErrors ? new Error('Workflow step failed') : e; }
    }
  } };
  await new ExtractionWorkflow({} as ExecutionContext, env).run({ payload: { id } } as any, step as any);
  return durableValues;
}
async function personalJob(env: ReturnType<typeof testEnv>['env'], provider: Provider = 'openai', segments = [{ id: 'p', label: '第 1 页', text }]) {
  const c = await saveCredential(env, owner, { name: '个人测试', config: modelDefaults(provider), apiKey: 'personal-test-secret', remember: false });
  return createJob(env, owner, { name: '格式测试', segments, selection: { mode: 'personal', credentialId: c.id } });
}
afterEach(() => vi.unstubAllGlobals());
describe('后台任务、清理与用量闭环', () => {
  for (const provider of ['openai', 'claude', 'deepseek', 'zhipu', 'qwen'] as const) it(`${provider} 完整任务结果保持指定格式，完成后清理任务密钥`, async () => {
    const { env, sqlite, objects } = testEnv(), job = await personalJob(env, provider);
    const fetcher = vi.fn().mockResolvedValue(Response.json(reply(provider))); vi.stubGlobal('fetch', fetcher);
    const durable = await run(env, job.id), saved = JSON.parse(objects.get(`${job.id}/result.json`)!) as ExtractionResult;
    expect(compileTranslations(saved.candidates).content).toBe(text);
    expect(sqlite.prepare('SELECT status,input_tokens,output_tokens FROM jobs WHERE id=?').get(job.id)).toMatchObject({ status: 'completed', input_tokens: 100, output_tokens: 80 });
    expect(sqlite.prepare('SELECT active FROM admissions WHERE id=?').get(job.id)?.active).toBe(0);
    await expect(taskKey(env, job.id, owner)).rejects.toMatchObject({ status: 410 });
    expect([...objects.keys()]).toEqual([`${job.id}/result.json`]);
    expect(JSON.stringify(durable)).not.toContain('personal-test-secret'); expect(JSON.stringify(durable)).not.toContain('Somnia');
    expect(fetcher.mock.calls[0][1].headers.Authorization ?? fetcher.mock.calls[0][1].headers['x-api-key']).toContain('personal-test-secret');
  });
  it('团队调用使用团队 Secret，修改团队服务不会改变已提交的模型配置', async () => {
    const { env, sqlite } = testEnv(); env.TEAM_SERVICES = JSON.stringify([{ id: 'team-openai', name: '团队模型', config: modelDefaults('openai'), inputUsdPerMillion: 1, outputUsdPerMillion: 2 }]);
    const job = await createJob(env, owner, { name: '团队测试', segments: [{ id: 'p', label: '原文', text }], selection: { mode: 'team', serviceId: 'team-openai' } });
    env.TEAM_SERVICES = JSON.stringify([{ id: 'team-openai', name: '团队模型', config: modelDefaults('deepseek') }]);
    const fetcher = vi.fn().mockResolvedValue(Response.json(reply('openai'))); vi.stubGlobal('fetch', fetcher); await run(env, job.id);
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer team-test-key'); expect(JSON.parse(fetcher.mock.calls[0][1].body).model).toBe('gpt-4.1-mini');
    expect(sqlite.prepare('SELECT mode,estimated_usd FROM jobs WHERE id=?').get(job.id)).toMatchObject({ mode: 'team', estimated_usd: 0.00026 });
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM job_secrets').get()?.n).toBe(0);
  });
  it('401 失败没有自动切换或重试，清理个人密钥且给出明确错误', async () => {
    const { env, sqlite, objects } = testEnv(), job = await personalJob(env);
    const fetcher = vi.fn().mockResolvedValue(new Response('provider-private-detail personal-test-secret', { status: 401 })); vi.stubGlobal('fetch', fetcher);
    await expect(run(env, job.id, true)).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(1);
    const record = sqlite.prepare('SELECT status,error FROM jobs WHERE id=?').get(job.id);
    expect(record?.status).toBe('failed'); expect(record?.error).toContain('API Key 无效'); expect(record?.error).not.toContain('personal-test-secret');
    expect([...objects.keys()]).toHaveLength(0); await expect(taskKey(env, job.id, owner)).rejects.toThrow();
  });
  it('临时网络失败只重试一次且两次用量都计入个人服务', async () => {
    const { env, sqlite } = testEnv(), job = await personalJob(env);
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('network private data')).mockResolvedValueOnce(Response.json(reply('openai'))); vi.stubGlobal('fetch', fetcher);
    await run(env, job.id); expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sqlite.prepare('SELECT status,error FROM jobs WHERE id=?').get(job.id)).toMatchObject({ status: 'completed', error: null });
    expect(sqlite.prepare('SELECT COUNT(*) AS n,SUM(estimated) AS estimated FROM ai_usage WHERE mode=?').get('personal')).toMatchObject({ n: 2, estimated: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM ai_usage WHERE mode=?').get('team')?.n).toBe(0);
  });
  it('重试耗尽后仍保留具体模型错误，即使 Workflow 包装了异常', async () => {
    const { env, sqlite, objects } = testEnv(), job = await personalJob(env, 'deepseek');
    const fetcher = vi.fn().mockRejectedValue(new Error('private-network-detail')); vi.stubGlobal('fetch', fetcher);
    await expect(run(env, job.id, true)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
    const saved = sqlite.prepare('SELECT status,error FROM jobs WHERE id=?').get(job.id);
    expect(saved?.status).toBe('failed'); expect(saved?.error).toContain('模型连接超时或网络异常');
    expect(saved?.error).not.toContain('private-network-detail'); expect(saved?.error).not.toContain('Workflow step failed');
    expect(sqlite.prepare('SELECT active FROM admissions WHERE id=?').get(job.id)?.active).toBe(0);
    expect([...objects.keys()]).toHaveLength(0);
  });
  it('截断后自动二分，每部分独立重试，全部用量计入预留且原文无遗漏', async () => {
    const dataset = `${text}\n光伏组件 Photovoltaic Module`, parts = bisectText(dataset)!;
    const { env, sqlite, objects } = testEnv(), job = await personalJob(env, 'deepseek', [{ id: 's', label: '合成术语表', text: dataset }]);
    const received: string[] = [];
    const fetcher = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const source = JSON.parse(init.body as string).messages[1].content as string; received.push(source);
      if (received.length % 2) throw new Error('private transient network detail');
      if (source === dataset) return Response.json({ choices: [{ finish_reason: 'length', message: { content: '{"terms":[' } }], usage: { prompt_tokens: 100, completion_tokens: 8000 } });
      const terms = result.terms.filter(t => source.includes(t.source) && source.includes(t.target));
      if (source.includes('光伏组件')) terms.push({ source: '光伏组件', target: 'Photovoltaic Module', category: 'industry', priority: 80, basis: 'source', evidence: '光伏组件 Photovoltaic Module' });
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ terms }) } }], usage: { prompt_tokens: 100, completion_tokens: 80 } });
    });
    vi.stubGlobal('fetch', fetcher);
    const durable = await run(env, job.id), saved = JSON.parse(objects.get(`${job.id}/result.json`)!) as ExtractionResult;
    expect(received).toEqual([dataset, dataset, parts[0], parts[0], parts[1], parts[1]]);
    expect(saved.candidates.map(c => c.source)).toEqual(['Somnia', 'Industrial Collaboration', '光伏组件']);
    expect(new Set(saved.candidates.map(c => c.id)).size).toBe(3);
    expect(saved.warnings.join('')).toContain('自动拆小');
    const admission = sqlite.prepare('SELECT input_tokens,output_tokens,reserved_input,reserved_output,active FROM admissions WHERE id=?').get(job.id)!;
    expect(Number(admission.input_tokens)).toBeLessThanOrEqual(Number(admission.reserved_input));
    expect(Number(admission.output_tokens)).toBeLessThanOrEqual(Number(admission.reserved_output));
    expect(admission.active).toBe(0);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM ai_usage WHERE job_id=?').get(job.id)?.n).toBe(6);
    expect(sqlite.prepare('SELECT status,error FROM jobs WHERE id=?').get(job.id)).toMatchObject({ status: 'completed', error: null });
    expect([...objects.keys()]).toEqual([`${job.id}/result.json`]);
    expect(JSON.stringify(durable)).not.toContain('产业协同');
    await expect(taskKey(env, job.id, owner)).rejects.toThrow();
  });
  it('不可继续拆分的最小 Unicode 片段仍截断时停止并清理结果', async () => {
    const { env, sqlite, objects } = testEnv(), job = await personalJob(env, 'deepseek', [{ id: 's', label: '最小片段', text: '😀' }]);
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ choices: [{ finish_reason: 'length', message: { content: '{"terms":[' } }], usage: { prompt_tokens: 100, completion_tokens: 8000 } }));
    vi.stubGlobal('fetch', fetcher);
    await expect(run(env, job.id, true)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(sqlite.prepare('SELECT error FROM jobs WHERE id=?').get(job.id)?.error).toContain('最小片段仍无法完整输出');
    expect([...objects.keys()]).toHaveLength(0);
    expect(sqlite.prepare('SELECT active FROM admissions WHERE id=?').get(job.id)?.active).toBe(0);
  });
  it('密集双语表先按预算分片，截断的部分再拆小，最终保留所有词条', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => `CompoundTerm${i}\t合成词条${i}`), dataset = rows.join('\n');
    const { env, sqlite, objects } = testEnv(), job = await personalJob(env, 'deepseek', [{ id: 's', label: '密集术语表', text: dataset }]);
    const fetcher = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string), lines = (body.messages[1].content as string).split('\n').filter(Boolean);
      expect(body.max_tokens).toBe(8000);
      if (lines.length > 24) return Response.json({ choices: [{ finish_reason: 'length', message: { content: '{"terms":[' } }], usage: { prompt_tokens: 100, completion_tokens: 8000 } });
      const terms = lines.map(evidence => {
        const [source, target] = evidence.split('\t');
        return { source, target, category: 'industry', priority: 80, basis: 'source', evidence };
      });
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ terms }) } }], usage: { prompt_tokens: 100, completion_tokens: terms.length * 100 } });
    });
    vi.stubGlobal('fetch', fetcher);
    await run(env, job.id);
    const saved = JSON.parse(objects.get(`${job.id}/result.json`)!) as ExtractionResult;
    expect(saved.candidates.map(c => `${c.source}\t${c.target}`)).toEqual(rows);
    expect(new Set(saved.candidates.map(c => c.id)).size).toBe(rows.length);
    expect(saved.warnings.join('')).toContain('自动拆小 2 次');
    expect(fetcher).toHaveBeenCalledTimes(7);
    expect(sqlite.prepare('SELECT status,progress,total,input_tokens,output_tokens FROM jobs WHERE id=?').get(job.id)).toMatchObject({ status: 'completed', progress: 3, total: 3, input_tokens: 700, output_tokens: 26000 });
    expect([...objects.keys()]).toEqual([`${job.id}/result.json`]);
    expect(sqlite.prepare('SELECT active FROM admissions WHERE id=?').get(job.id)?.active).toBe(0);
  });
  it('已使用 40000 Token 时，24 片密集表仍可在默认团队额度内完整处理', async () => {
    const { env, sqlite, objects } = testEnv(), config = modelDefaults('deepseek');
    env.TEAM_SERVICES = JSON.stringify([{ id: 'deepseek', name: '团队模型', config }]);
    const previous = await createJob(env, owner, { name: '旧失败任务', segments: [{ id: 'p', label: '原文', text }], selection: { mode: 'team', serviceId: 'deepseek' } });
    await recordUsage(env, { id: previous.id, owner, mode: 'team', provider: 'deepseek', model: config.model }, { input: null, output: null }, { input: 48017, output: 40000, estimated: false });
    await releaseTask(env, previous.id);
    sqlite.prepare("UPDATE jobs SET status='failed' WHERE id=?").run(previous.id);
    const segments = Array.from({ length: 24 }, (_, sheet) => ({ id: `${sheet}`, label: `工作表${sheet}`, text: Array.from({ length: 38 }, (_, row) => `Term${sheet}_${row}\t词条${sheet}_${row}`).join('\n') }));
    const job = await createJob(env, owner, { name: '24 片术语表', segments, selection: { mode: 'team', serviceId: 'deepseek' } });
    expect((await settings(env, owner)).available.teamOutput).toBeNull();
    const fetcher = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const source = JSON.parse(init.body as string).messages[1].content as string;
      const terms = source.split('\n').filter(Boolean).map(evidence => {
        const [source, target] = evidence.split('\t');
        return { source, target, category: 'industry', priority: 80, basis: 'source', evidence };
      });
      expect((await settings(env, owner)).available.teamOutput).toBeNull();
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ terms }) } }], usage: { prompt_tokens: 100, completion_tokens: terms.length * 80 } });
    });
    vi.stubGlobal('fetch', fetcher); await run(env, job.id);
    const saved = JSON.parse(objects.get(`${job.id}/result.json`)!) as ExtractionResult;
    expect(saved.candidates.map(c => `${c.source}\t${c.target}`)).toEqual(segments.flatMap(s => s.text.split('\n')));
    expect(fetcher).toHaveBeenCalledTimes(24);
    expect((await settings(env, owner)).usage.find(r => r.mode === 'team')?.output_tokens).toBe(40000 + 24 * 38 * 80);
    expect(sqlite.prepare('SELECT status,total,progress FROM jobs WHERE id=?').get(job.id)).toMatchObject({ status: 'completed', total: 24, progress: 24 });
  });
  it('旧每日额度不会中断拆分恢复，全部子片段完成并记录实际用量', async () => {
    const { env, sqlite, objects } = testEnv(), config = modelDefaults('deepseek');
    env.TEAM_SERVICES = JSON.stringify([{ id: 'deepseek', name: '团队模型', config }]);
    sqlite.prepare('INSERT INTO member_policies VALUES(?,?)').run(owner, JSON.stringify({ email: owner, teamDailyOutput: 16000 }));
    const job = await createJob(env, owner, { name: '恢复额度测试', segments: [{ id: 's', label: '原文', text: `${text}\n光伏组件 Photovoltaic Module` }], selection: { mode: 'team', serviceId: 'deepseek' } });
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ choices: [{ finish_reason: 'length' }], usage: { prompt_tokens: 100, completion_tokens: 8000 } }))
      .mockResolvedValueOnce(Response.json(reply('deepseek')))
      .mockResolvedValueOnce(Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ terms: [{ source: '光伏组件', target: 'Photovoltaic Module', category: 'industry', priority: 80, basis: 'source', evidence: '光伏组件 Photovoltaic Module' }], complete: true }) } }], usage: { prompt_tokens: 100, completion_tokens: 80 } }));
    vi.stubGlobal('fetch', fetcher); await run(env, job.id);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(sqlite.prepare('SELECT status,error,output_tokens FROM jobs WHERE id=?').get(job.id)).toMatchObject({ status: 'completed', error: null, output_tokens: 8160 });
    const saved = JSON.parse(objects.get(`${job.id}/result.json`)!) as ExtractionResult;
    expect(saved.candidates.map(c => c.source)).toEqual(['Somnia', 'Industrial Collaboration', '光伏组件']);
    expect([...objects.keys()]).toEqual([`${job.id}/result.json`]);
    expect((await settings(env, owner)).available.teamOutput).toBeNull();
  });
  for (const scenario of ['truncated', 'incomplete']) it(`${scenario} 可以继续多轮二分，最终覆盖全部词条`, async () => {
    const rows = Array.from({ length: 32 }, (_, i) => `Term${String(i).padStart(2, '0')}\t词条${String(i).padStart(2, '0')}`);
    const { env, objects, sqlite } = testEnv(), job = await personalJob(env, 'deepseek', [{ id: 's', label: '多轮术语表', text: rows.join('\n') }]);
    const fetcher = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const lines = (JSON.parse(init.body as string).messages[1].content as string).split('\n').filter(Boolean);
      const terms = lines.map(evidence => {
        const [source, target] = evidence.split('\t');
        return { source, target, category: 'industry', priority: 80, basis: 'source', evidence };
      });
      if (lines.length > 8 && scenario === 'truncated') return Response.json({ choices: [{ finish_reason: 'length' }], usage: { prompt_tokens: 100, completion_tokens: 8000 } });
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ terms: lines.length > 8 ? terms.slice(0, 1) : terms, complete: lines.length <= 8 }) } }], usage: { prompt_tokens: 100, completion_tokens: 80 } });
    });
    vi.stubGlobal('fetch', fetcher); const durable = await run(env, job.id);
    const saved = JSON.parse(objects.get(`${job.id}/result.json`)!) as ExtractionResult;
    expect(saved.candidates.map(c => `${c.source}\t${c.target}`)).toEqual(rows);
    expect(new Set(saved.candidates.map(c => c.id)).size).toBe(rows.length);
    expect(saved.warnings.join('')).toContain('自动拆小 3 次');
    expect(fetcher).toHaveBeenCalledTimes(7);
    expect(sqlite.prepare('SELECT status,error FROM jobs WHERE id=?').get(job.id)).toMatchObject({ status: 'completed', error: null });
    expect(JSON.stringify(durable)).not.toContain('词条');
    expect([...objects.keys()]).toEqual([`${job.id}/result.json`]);
  });
  it('一个片段成功、另一个截断时整项失败，不留下部分结果或密钥', async () => {
    const { env, objects, sqlite } = testEnv(), job = await personalJob(env, 'openai', [{ id: 'p', label: '第一页', text }, { id: 'q', label: '第二页', text: '字'.repeat(10000) }]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json(reply('openai'))).mockResolvedValueOnce(Response.json({ ...reply('openai'), status: 'incomplete' })));
    await expect(run(env, job.id)).rejects.toThrow(); expect([...objects.keys()]).toHaveLength(0);
    expect(sqlite.prepare('SELECT output_tokens FROM jobs WHERE id=?').get(job.id)?.output_tokens).toBe(160);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM job_secrets').get()?.n).toBe(0);
  });
  it('超时任务和未提交临时密钥由定时清理回收', async () => {
    const { env, sqlite, objects, terminated } = testEnv(), job = await personalJob(env);
    await saveCredential(env, owner, { name: '未提交', config: modelDefaults('openai'), apiKey: 'another-secret-key', remember: false });
    sqlite.prepare('UPDATE credentials SET expires_at=1').run(); sqlite.prepare('UPDATE jobs SET created_at=1').run();
    await worker.scheduled({} as ScheduledController, env);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM credentials').get()?.n).toBe(0);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM job_secrets').get()?.n).toBe(0);
    expect(sqlite.prepare('SELECT status FROM jobs WHERE id=?').get(job.id)?.status).toBe('failed'); expect(terminated).toEqual([job.id]); expect([...objects.keys()]).toHaveLength(0);
  });
});

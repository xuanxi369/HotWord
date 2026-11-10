import { afterEach, describe, expect, it, vi } from 'vitest';
import { createJob } from '../server/jobs';
import { saveCredential, taskKey } from '../server/credentials';
import { ExtractionWorkflow } from '../server/workflow';
import worker from '../server/index';
import { modelDefaults, type Provider } from '../shared/models';
import { compileTranslations } from '../shared/compiler';
import type { ExtractionResult } from '../shared/schema';
import { testEnv } from './support/database';
import { NonRetryableError } from './support/workflow-runtime';

const text = 'Somnia-梦境公链，Industrial Collaboration-产业协同';
const result = { terms: [{ source: 'Somnia', target: '梦境公链', category: 'company', priority: 90, basis: 'source', evidence: text }, { source: 'Industrial Collaboration', target: '产业协同', category: 'industry', priority: 80, basis: 'source', evidence: text }] };
function reply(provider: Provider) {
  const content = JSON.stringify(result);
  if (provider === 'openai') return { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: content }] }], usage: { input_tokens: 100, output_tokens: 80 } };
  if (provider === 'claude') return { stop_reason: 'end_turn', content: [{ type: 'text', text: content }], usage: { input_tokens: 100, output_tokens: 80 } };
  return { choices: [{ finish_reason: 'stop', message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 80 } };
}
const owner = 'member@example.com';
async function run(env: ReturnType<typeof testEnv>['env'], id: string) {
  const durableValues: unknown[] = [];
  const step = { async do(_name: string, options: any, work?: () => Promise<unknown>) {
    const fn = work ?? options, retries = work ? options.retries?.limit ?? 0 : 0;
    for (let attempt = 0; ; attempt++) {
      try { const value = await fn(); durableValues.push(value); return value; }
      catch (e) { if (e instanceof NonRetryableError || attempt >= retries) throw e; }
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
    await expect(run(env, job.id)).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(1);
    const record = sqlite.prepare('SELECT status,error FROM jobs WHERE id=?').get(job.id);
    expect(record?.status).toBe('failed'); expect(record?.error).toContain('API Key 无效'); expect(record?.error).not.toContain('personal-test-secret');
    expect([...objects.keys()]).toHaveLength(0); await expect(taskKey(env, job.id, owner)).rejects.toThrow();
  });
  it('临时网络失败只重试一次且两次用量都计入个人服务', async () => {
    const { env, sqlite } = testEnv(), job = await personalJob(env);
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('network private data')).mockResolvedValueOnce(Response.json(reply('openai'))); vi.stubGlobal('fetch', fetcher);
    await run(env, job.id); expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sqlite.prepare('SELECT COUNT(*) AS n,SUM(estimated) AS estimated FROM ai_usage WHERE mode=?').get('personal')).toMatchObject({ n: 2, estimated: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM ai_usage WHERE mode=?').get('team')?.n).toBe(0);
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

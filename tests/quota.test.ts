import { describe, expect, it } from 'vitest';
import { callBudget } from '../server/ai';
import { createJob } from '../server/jobs';
import { fetchApi } from '../server/http';
import { admitProbe, policy, settings } from '../server/models';
import { recordUsage, releaseTask, reserveModelCall } from '../server/store';
import { modelDefaults } from '../shared/models';
import { testEnv } from './support/database';

const owner = 'member@example.com', config = modelDefaults('deepseek'), text = '产业协同 Industrial Collaboration';
const pricing = { input: 0, output: 1000 }, budget = callBudget(config, text);
function teamEnv() {
  const result = testEnv();
  result.env.TEAM_SERVICES = JSON.stringify([{ id: 'deepseek', name: '团队模型', config, inputUsdPerMillion: pricing.input, outputUsdPerMillion: pricing.output }]);
  result.sqlite.prepare('INSERT INTO member_policies VALUES(?,?)').run(owner, JSON.stringify({ email: owner, teamDailyTasks: 0, teamDailyInput: 0, teamDailyOutput: 1, teamDailyUsd: 0 }));
  return result;
}
async function job(env: ReturnType<typeof testEnv>['env']) {
  const created = await createJob(env, owner, { name: '无限额测试', segments: [{ id: 's', label: '原文', text }], selection: { mode: 'team', serviceId: 'deepseek' } });
  return { id: created.id, owner, mode: 'team', provider: config.provider, model: config.model };
}

describe('不设每日任务、Token 或金额额度', () => {
  it('旧数据库额度归一为不限，零额度和未计价也可创建任务', async () => {
    const { env } = teamEnv();
    env.TEAM_SERVICES = JSON.stringify([{ id: 'deepseek', name: '未计价服务', config }]);
    expect((await job(env)).id).toBeTruthy();
    expect(await policy(env, owner)).toMatchObject({ teamDailyTasks: null, teamDailyInput: null, teamDailyOutput: null, teamDailyUsd: null });
    expect((await settings(env, owner)).available).toMatchObject({ teamTasks: null, teamInput: null, teamOutput: null, teamUsd: null, platformTasks: null, concurrency: 1 });
  });
  it('高 Token 用量和金额不会阻断下一次调用，真实用量仍累计保存', async () => {
    const { env, sqlite } = teamEnv(), task = await job(env);
    await reserveModelCall(env, task, pricing, budget);
    await recordUsage(env, task, pricing, { input: 3000000, output: 2000000, estimated: false });
    await reserveModelCall(env, task, pricing, budget);
    expect(sqlite.prepare('SELECT input_tokens,output_tokens,reserved_output,estimated_usd FROM admissions WHERE id=?').get(task.id)).toMatchObject({ input_tokens: 3000000, output_tokens: 2000000, reserved_output: 2008000, estimated_usd: 2000 });
    await recordUsage(env, task, pricing, { input: 100, output: 80, estimated: false });
    await releaseTask(env, task.id);
    expect((await settings(env, owner)).usage.find(r => r.mode === 'team')).toMatchObject({ input_tokens: 3000100, output_tokens: 2000080, estimated_usd: 2000.08 });
    expect(sqlite.prepare('SELECT active,reserved_output FROM admissions WHERE id=?').get(task.id)).toMatchObject({ active: 0, reserved_output: 2000080 });
  });
  it('管理员接口也将旧额度显示为不限，数据库历史设置不用迁移', async () => {
    const { env, sqlite } = teamEnv();
    const response = await fetchApi(new Request('http://localhost/api/admin/models'), env);
    expect(response.status).toBe(200);
    expect((await response.json() as { policies: unknown[] }).policies[0]).toMatchObject({ teamDailyTasks: null, teamDailyInput: null, teamDailyOutput: null, teamDailyUsd: null });
    expect(JSON.parse(String(sqlite.prepare('SELECT config FROM member_policies WHERE email=?').get(owner)?.config)).teamDailyOutput).toBe(1);
  });
  it('两个活跃任务都能继续调用，第三个任务仍受并发数量保护', async () => {
    const { env } = teamEnv(), first = await job(env), second = await job(env);
    const attempts = await Promise.allSettled([reserveModelCall(env, first, pricing, budget), reserveModelCall(env, second, pricing, budget)]);
    expect(attempts.every(r => r.status === 'fulfilled')).toBe(true);
    await expect(job(env)).rejects.toMatchObject({ status: 429, message: '同时运行的任务已达上限，请等待当前任务结束后重试' });
  });
  it('超过旧成员和全站每日任务数后，仍可以创建新任务', async () => {
    const { env, sqlite } = teamEnv();
    const insert = sqlite.prepare('INSERT INTO admissions(id,owner,mode,created_at,active) VALUES(?,?,?,?,0)');
    for (let i = 0; i < 250; i++) insert.run('past-' + i, owner, 'team', Date.now());
    expect((await job(env)).id).toBeTruthy();
    const snapshot = await settings(env, owner);
    expect(snapshot.platformDailyTasks).toBeNull(); expect(snapshot.available.platformTasks).toBeNull();
    expect(snapshot.usage.find(r => r.mode === 'team')?.tasks).toBe(251);
  });
  it('连接测试次数不设每日上限，继续保存调用记录', async () => {
    const { env, sqlite } = teamEnv();
    for (let i = 0; i < 25; i++) await admitProbe(env, owner);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM connection_probes').get()?.n).toBe(25);
  });
  it('已取消任务及错误成员不能获得新的模型调用预留', async () => {
    const { env } = teamEnv(), task = await job(env);
    await expect(reserveModelCall(env, { ...task, owner: 'other@example.com' }, pricing, budget)).rejects.toMatchObject({ status: 410 });
    await releaseTask(env, task.id);
    await expect(reserveModelCall(env, task, pricing, budget)).rejects.toMatchObject({ status: 410 });
  });
});

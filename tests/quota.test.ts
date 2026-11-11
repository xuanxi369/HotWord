import { describe, expect, it } from 'vitest';
import { callBudget } from '../server/ai';
import { createJob } from '../server/jobs';
import { settings } from '../server/models';
import { recordUsage, releaseTask, reserveModelCall } from '../server/store';
import { modelDefaults } from '../shared/models';
import { testEnv } from './support/database';

const owner = 'member@example.com', config = modelDefaults('deepseek'), text = '产业协同 Industrial Collaboration';
const pricing = { input: 0, output: 1000 }, budget = callBudget(config, text);
function teamEnv(output = 1000000, usd: number | null = null) {
  const result = testEnv();
  result.env.TEAM_SERVICES = JSON.stringify([{ id: 'deepseek', name: '团队模型', config, inputUsdPerMillion: pricing.input, outputUsdPerMillion: pricing.output }]);
  result.sqlite.prepare('INSERT INTO member_policies VALUES(?,?)').run(owner, JSON.stringify({ email: owner, teamDailyOutput: output, teamDailyUsd: usd }));
  return result;
}
async function job(env: ReturnType<typeof testEnv>['env']) {
  const created = await createJob(env, owner, { name: '额度测试', segments: [{ id: 's', label: '原文', text }], selection: { mode: 'team', serviceId: 'deepseek' } });
  return { id: created.id, owner, mode: 'team', provider: config.provider, model: config.model };
}

describe('每次模型调用的原子额度预留', () => {
  it('首个调用不重复预留，返回时立即释放未消耗部分，再按需预留下次调用', async () => {
    const { env, sqlite } = teamEnv(), task = await job(env);
    await reserveModelCall(env, task, pricing, budget);
    expect((await settings(env, owner)).available.teamOutput).toBe(1000000 - 8000);
    await recordUsage(env, task, pricing, { input: 100, output: 80, estimated: false });
    expect((await settings(env, owner)).available.teamOutput).toBe(1000000 - 80);
    expect(sqlite.prepare('SELECT active FROM admissions WHERE id=?').get(task.id)?.active).toBe(1);
    await reserveModelCall(env, task, pricing, budget);
    expect((await settings(env, owner)).available.teamOutput).toBe(1000000 - 80 - 8000);
    await recordUsage(env, task, pricing, { input: 100, output: 8000, estimated: false });
    await releaseTask(env, task.id);
    expect((await settings(env, owner)).available.teamOutput).toBe(1000000 - 8080);
  });
  it('两个活跃任务不能同时占用同一份剩余额度', async () => {
    const { env, sqlite } = teamEnv(24000), first = await job(env), second = await job(env);
    for (const task of [first, second]) await recordUsage(env, task, pricing, { input: 100, output: 8000, estimated: false });
    const attempts = await Promise.allSettled([reserveModelCall(env, first, pricing, budget), reserveModelCall(env, second, pricing, budget)]);
    expect(attempts.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = attempts.find(r => r.status === 'rejected');
    expect(rejected).toMatchObject({ reason: { status: 429 } });
    expect((await settings(env, owner)).available.teamOutput).toBe(0);
    expect(sqlite.prepare('SELECT SUM(output_tokens) AS used,SUM(reserved_output) AS held FROM admissions').get()).toMatchObject({ used: 16000, held: 24000 });
  });
  it('真实输出额度不足时拒绝下次调用，保留已消耗用量', async () => {
    const { env, sqlite } = teamEnv(16000), task = await job(env);
    await recordUsage(env, task, pricing, { input: 100, output: 12000, estimated: false });
    await expect(reserveModelCall(env, task, pricing, budget)).rejects.toMatchObject({ status: 429, message: '团队输出 Token 额度不足：下一次调用需预留 8,000，当前可用 4,000，请联系管理员或稍后重试' });
    expect(sqlite.prepare('SELECT output_tokens,reserved_output FROM admissions WHERE id=?').get(task.id)).toMatchObject({ output_tokens: 12000, reserved_output: 12000 });
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM ai_usage').get()?.n).toBe(1);
  });
  it('下一次调用仍需通过输入 Token 和金额限额', async () => {
    const { env, sqlite } = teamEnv(1000000, 16), task = await job(env);
    await recordUsage(env, task, pricing, { input: 100, output: 12000, estimated: false });
    await expect(reserveModelCall(env, task, pricing, budget)).rejects.toMatchObject({ status: 429, message: '团队金额额度不足或额度发生并发变化，请刷新后重试' });
    sqlite.prepare('UPDATE member_policies SET config=? WHERE email=?').run(JSON.stringify({ email: owner, teamDailyInput: 100, teamDailyOutput: 1000000 }), owner);
    await expect(reserveModelCall(env, task, pricing, budget)).rejects.toMatchObject({ status: 429 });
    expect(sqlite.prepare('SELECT input_tokens,output_tokens FROM admissions WHERE id=?').get(task.id)).toMatchObject({ input_tokens: 100, output_tokens: 12000 });
  });
  it('已取消的任务不能获得新的模型调用额度', async () => {
    const { env } = teamEnv(), task = await job(env);
    await releaseTask(env, task.id);
    await expect(reserveModelCall(env, task, pricing, budget)).rejects.toMatchObject({ status: 410 });
  });
  it('团队不足明确指出所需及可用 Token，不提示配置个人密钥', async () => {
    const { env } = teamEnv(7999);
    await expect(job(env)).rejects.toMatchObject({ status: 429, message: '团队输出 Token 额度不足：本次调用需预留 8,000，当前可用 7,999，请降低输出上限或联系管理员' });
  });
});

import type { Env } from './env';
import type { TokenUsage } from './providers';
import { HttpError } from './auth';
import { policy } from './models';
export type Pricing = { input: number | null; output: number | null };
export function price(usage: { input: number; output: number }, pricing: Pricing) {
  return pricing.input === null || pricing.output === null ? null : (usage.input * pricing.input + usage.output * pricing.output) / 1000000;
}
export async function reserveModelCall(env: Env, job: { id: string; owner: string; mode: string }, pricing: Pricing, budget: { input: number; output: number }) {
  const team = job.mode === 'team', limits = team ? await policy(env, job.owner) : null, cost = price(budget, pricing), since = Date.now() - 86400000;
  if (limits && limits.teamDailyUsd !== null && cost === null) throw new HttpError(503, '该团队模型未配置价格，无法执行金额额度校验，请联系管理员');
  // Replace our own hold with spent usage plus the upcoming call, while every
  // other active task keeps its hold. One SQL statement prevents concurrent
  // tasks from claiming the same remaining team budget.
  const reserved = await env.DB.prepare(`UPDATE admissions SET reserved_input=input_tokens+?,reserved_output=output_tokens+?,reserved_usd=estimated_usd+?
    WHERE id=? AND active=1 AND (?=0 OR (
      COALESCE((SELECT SUM(CASE WHEN active=1 THEN MAX(input_tokens,reserved_input) ELSE input_tokens END) FROM admissions WHERE owner=? AND mode='team' AND created_at>? AND id<>?),0)+input_tokens+?<=? AND
      COALESCE((SELECT SUM(CASE WHEN active=1 THEN MAX(output_tokens,reserved_output) ELSE output_tokens END) FROM admissions WHERE owner=? AND mode='team' AND created_at>? AND id<>?),0)+output_tokens+?<=? AND
      (? IS NULL OR COALESCE((SELECT SUM(CASE WHEN active=1 THEN MAX(estimated_usd,reserved_usd) ELSE estimated_usd END) FROM admissions WHERE owner=? AND mode='team' AND created_at>? AND id<>?),0)+estimated_usd+?<=?)))`)
    .bind(budget.input, budget.output, cost ?? 0, job.id, team ? 1 : 0,
      job.owner, since, job.id, budget.input, limits?.teamDailyInput ?? 0,
      job.owner, since, job.id, budget.output, limits?.teamDailyOutput ?? 0,
      limits?.teamDailyUsd ?? null, job.owner, since, job.id, cost ?? 0, limits?.teamDailyUsd ?? null).run();
  if (reserved.meta.changes) return;
  const admission = await env.DB.prepare('SELECT active FROM admissions WHERE id=?').bind(job.id).first<{ active: number }>();
  if (!admission?.active) throw new HttpError(410, '任务已取消或结束');
  const spent = await env.DB.prepare(`SELECT
    COALESCE(SUM(CASE WHEN id=? THEN input_tokens WHEN active=1 THEN MAX(input_tokens,reserved_input) ELSE input_tokens END),0) AS input,
    COALESCE(SUM(CASE WHEN id=? THEN output_tokens WHEN active=1 THEN MAX(output_tokens,reserved_output) ELSE output_tokens END),0) AS output,
    COALESCE(SUM(CASE WHEN id=? THEN estimated_usd WHEN active=1 THEN MAX(estimated_usd,reserved_usd) ELSE estimated_usd END),0) AS usd
    FROM admissions WHERE owner=? AND mode='team' AND created_at>?`).bind(job.id, job.id, job.id, job.owner, since).first<{ input: number; output: number; usd: number }>();
  const input = Math.max(0, (limits?.teamDailyInput ?? 0) - (spent?.input ?? 0)), output = Math.max(0, (limits?.teamDailyOutput ?? 0) - (spent?.output ?? 0));
  if (budget.input > input) throw new HttpError(429, `团队输入 Token 额度不足：下一次调用需预留 ${budget.input.toLocaleString()}，当前可用 ${input.toLocaleString()}，请联系管理员或分批处理`);
  if (budget.output > output) throw new HttpError(429, `团队输出 Token 额度不足：下一次调用需预留 ${budget.output.toLocaleString()}，当前可用 ${output.toLocaleString()}，请联系管理员或稍后重试`);
  throw new HttpError(429, '团队金额额度不足或额度发生并发变化，请刷新后重试');
}
export async function recordUsage(env: Env, job: { id: string; owner: string; mode: string; provider: string; model: string }, pricing: Pricing, usage: TokenUsage) {
  const cost = price(usage, pricing);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO ai_usage(id,job_id,owner,mode,provider,model,input_tokens,output_tokens,estimated_usd,estimated,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), job.id, job.owner, job.mode, job.provider, job.model, usage.input, usage.output, cost, usage.estimated ? 1 : 0, Date.now()),
    env.DB.prepare('UPDATE admissions SET input_tokens=input_tokens+?,output_tokens=output_tokens+?,estimated_usd=estimated_usd+?,reserved_input=input_tokens+?,reserved_output=output_tokens+?,reserved_usd=estimated_usd+? WHERE id=?')
      .bind(usage.input, usage.output, cost ?? 0, usage.input, usage.output, cost ?? 0, job.id),
    env.DB.prepare('UPDATE jobs SET input_tokens=input_tokens+?,output_tokens=output_tokens+?,estimated_usd=CASE WHEN ? IS NULL THEN NULL ELSE COALESCE(estimated_usd,0)+? END,usage_estimated=MAX(usage_estimated,?) WHERE id=?')
      .bind(usage.input, usage.output, cost, cost, usage.estimated ? 1 : 0, job.id),
  ]);
}
export async function deleteObjects(env: Env, id: string, keepResult = false) {
  let cursor: string | undefined;
  do {
    const page = await env.FILES.list({ prefix: `${id}/`, cursor });
    const keys = page.objects.map(o => o.key).filter(k => !keepResult || k !== `${id}/result.json`);
    if (keys.length) await env.FILES.delete(keys);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
export async function releaseTask(env: Env, id: string) {
  await env.DB.batch([env.DB.prepare('DELETE FROM job_secrets WHERE job_id=?').bind(id), env.DB.prepare('UPDATE admissions SET active=0 WHERE id=?').bind(id)]);
}

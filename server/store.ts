import type { Env } from './env';
import type { TokenUsage } from './providers';
export type Pricing = { input: number | null; output: number | null };
export function price(usage: { input: number; output: number }, pricing: Pricing) {
  return pricing.input === null || pricing.output === null ? null : (usage.input * pricing.input + usage.output * pricing.output) / 1000000;
}
export async function recordUsage(env: Env, job: { id: string; owner: string; mode: string; provider: string; model: string }, pricing: Pricing, usage: TokenUsage) {
  const cost = price(usage, pricing);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO ai_usage(id,job_id,owner,mode,provider,model,input_tokens,output_tokens,estimated_usd,estimated,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), job.id, job.owner, job.mode, job.provider, job.model, usage.input, usage.output, cost, usage.estimated ? 1 : 0, Date.now()),
    env.DB.prepare('UPDATE admissions SET input_tokens=input_tokens+?,output_tokens=output_tokens+?,estimated_usd=estimated_usd+? WHERE id=?').bind(usage.input, usage.output, cost ?? 0, job.id),
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

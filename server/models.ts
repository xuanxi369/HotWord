import { z } from 'zod';
import { MemberPolicySchema, TeamServiceSchema, modelDefaults, type MemberPolicy, type ModelSettings, type TeamService, type UsageSummary } from '../shared/models';
import { HttpError } from './auth';
import { encryptionReady, publicCredential, type StoredCredential } from './credentials';
import { teamKey } from './providers';
import type { Env } from './env';

export const platformLimits = { dailyTasks: 30, concurrency: 2, globalDailyTasks: 200 };
export function isAdmin(env: Env, user: { email: string; local: boolean }) {
  return user.local || (env.ADMIN_EMAILS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean).includes(user.email);
}
export function requireAdmin(env: Env, user: { email: string; local: boolean }) { if (!isAdmin(env, user)) throw new HttpError(403, '此操作仅限团队管理员'); }
export async function services(env: Env): Promise<TeamService[]> {
  let defaults: TeamService[];
  try {
    defaults = env.TEAM_SERVICES ? z.array(TeamServiceSchema).max(40).parse(JSON.parse(env.TEAM_SERVICES)) : [TeamServiceSchema.parse({ id: 'workers-ai', name: '团队 Workers AI', config: modelDefaults('cloudflare', env.AI_MODEL) })];
    if (new Set(defaults.map(s => s.id)).size !== defaults.length) throw new Error();
  } catch { throw new HttpError(503, '团队模型配置无效，请管理员检查 TEAM_SERVICES'); }
  const overrides = await env.DB.prepare('SELECT config FROM team_services').all<{ config: string }>();
  const merged = new Map(defaults.map(s => [s.id, s]));
  for (const row of overrides.results) { const s = TeamServiceSchema.parse(JSON.parse(row.config)); merged.set(s.id, s); }
  return [...merged.values()];
}
export function serviceReady(env: Env, service: TeamService) { try { teamKey(env, service.config.provider); return true; } catch { return false; } }
export async function policy(env: Env, email: string): Promise<MemberPolicy> {
  const row = await env.DB.prepare('SELECT config FROM member_policies WHERE email=?').bind(email).first<{ config: string }>();
  return row ? MemberPolicySchema.parse(JSON.parse(row.config)) : { email, teamDailyTasks: 20, teamDailyInput: 2000000, teamDailyOutput: 1000000, teamDailyUsd: null };
}
export async function usageSummary(env: Env, owner?: string): Promise<UsageSummary[]> {
  const since = Date.now() - 86400000, filter = owner ? ' AND owner=?' : '', args = owner ? [since, owner] : [since];
  const counts = await env.DB.prepare(`SELECT mode,COUNT(*) AS tasks FROM admissions WHERE created_at>?${filter} GROUP BY mode`).bind(...args).all<{ mode: 'team' | 'personal'; tasks: number }>();
  const sums = await env.DB.prepare(`SELECT mode,SUM(input_tokens) AS input_tokens,SUM(output_tokens) AS output_tokens,SUM(estimated_usd) AS estimated_usd,SUM(estimated) AS estimated_calls,SUM(CASE WHEN estimated_usd IS NULL THEN 1 ELSE 0 END) AS unpriced_calls FROM ai_usage WHERE created_at>?${filter} GROUP BY mode`).bind(...args).all<UsageSummary>();
  return (['team', 'personal'] as const).map(mode => ({ mode, tasks: counts.results.find(r => r.mode === mode)?.tasks ?? 0, input_tokens: 0, output_tokens: 0, estimated_usd: null, estimated_calls: 0, unpriced_calls: 0, ...sums.results.find(r => r.mode === mode) }));
}
export async function settings(env: Env, owner: string): Promise<ModelSettings> {
  const available = await services(env);
  const rows = await env.DB.prepare('SELECT * FROM credentials WHERE owner=? AND (expires_at IS NULL OR expires_at>?) ORDER BY created_at DESC').bind(owner, Date.now()).all<StoredCredential>();
  const limits = await policy(env, owner), since = Date.now() - 86400000;
  const spent = await env.DB.prepare(`SELECT COUNT(*) AS tasks,COALESCE(SUM(CASE WHEN active=1 THEN MAX(input_tokens,reserved_input) ELSE input_tokens END),0) AS input,
    COALESCE(SUM(CASE WHEN active=1 THEN MAX(output_tokens,reserved_output) ELSE output_tokens END),0) AS output,
    COALESCE(SUM(CASE WHEN active=1 THEN MAX(estimated_usd,reserved_usd) ELSE estimated_usd END),0) AS usd FROM admissions WHERE owner=? AND mode='team' AND created_at>?`)
    .bind(owner, since).first<{ tasks: number; input: number; output: number; usd: number }>();
  const platform = await env.DB.prepare('SELECT COUNT(CASE WHEN created_at>? THEN 1 END) AS tasks,COUNT(CASE WHEN active=1 THEN 1 END) AS active FROM admissions WHERE owner=?')
    .bind(since, owner).first<{ tasks: number; active: number }>();
  return { services: available.filter(s => s.enabled).map(s => ({ ...s, ready: serviceReady(env, s) })), credentials: rows.results.map(publicCredential),
    policy: limits, usage: await usageSummary(env, owner), personalReady: await encryptionReady(env), platformDailyTasks: platformLimits.dailyTasks, platformConcurrency: platformLimits.concurrency,
    available: { teamTasks: Math.max(0, limits.teamDailyTasks - (spent?.tasks ?? 0)), teamInput: Math.max(0, limits.teamDailyInput - (spent?.input ?? 0)), teamOutput: Math.max(0, limits.teamDailyOutput - (spent?.output ?? 0)),
      teamUsd: limits.teamDailyUsd === null ? null : Math.max(0, limits.teamDailyUsd - (spent?.usd ?? 0)), platformTasks: Math.max(0, platformLimits.dailyTasks - (platform?.tasks ?? 0)), concurrency: Math.max(0, platformLimits.concurrency - (platform?.active ?? 0)) } };
}
export async function admitProbe(env: Env, owner: string) {
  const result = await env.DB.prepare('INSERT INTO connection_probes(id,owner,created_at) SELECT ?,?,? WHERE (SELECT COUNT(*) FROM connection_probes WHERE owner=? AND created_at>?)<20')
    .bind(crypto.randomUUID(), owner, Date.now(), owner, Date.now() - 86400000).run();
  if (!result.meta.changes) throw new HttpError(429, '连接测试次数已达每日 20 次，请稍后再试');
}

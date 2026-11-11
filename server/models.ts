import { z } from 'zod';
import { MemberPolicySchema, TeamServiceSchema, modelDefaults, type MemberPolicy, type ModelSettings, type TeamService, type UsageSummary } from '../shared/models';
import { HttpError } from './auth';
import { encryptionReady, publicCredential, type StoredCredential } from './credentials';
import { teamKey } from './providers';
import type { Env } from './env';

export const platformLimits = { dailyTasks: null, concurrency: 2, globalDailyTasks: null };
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
  return MemberPolicySchema.parse(row ? JSON.parse(row.config) : { email });
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
  const limits = await policy(env, owner);
  const platform = await env.DB.prepare('SELECT COUNT(*) AS active FROM admissions WHERE owner=? AND active=1')
    .bind(owner).first<{ active: number }>();
  return { services: available.filter(s => s.enabled).map(s => ({ ...s, ready: serviceReady(env, s) })), credentials: rows.results.map(publicCredential),
    policy: limits, usage: await usageSummary(env, owner), personalReady: await encryptionReady(env), platformDailyTasks: platformLimits.dailyTasks, platformConcurrency: platformLimits.concurrency,
    available: { teamTasks: null, teamInput: null, teamOutput: null, teamUsd: null, platformTasks: null, concurrency: Math.max(0, platformLimits.concurrency - (platform?.active ?? 0)) } };
}
export async function admitProbe(env: Env, owner: string) {
  await env.DB.prepare('INSERT INTO connection_probes(id,owner,created_at) VALUES(?,?,?)')
    .bind(crypto.randomUUID(), owner, Date.now()).run();
}

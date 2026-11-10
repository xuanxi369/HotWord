import { z } from 'zod';
import { MemberPolicySchema, TeamServiceSchema } from '../shared/models';
import { boundedJson, enforceOrigin, HttpError, identify } from './auth';
import { CredentialInputSchema, decryptKey, encryptionReady, ownedCredential, saveCredential } from './credentials';
import { createJob, jobColumns, ownedJob } from './jobs';
import { admitProbe, isAdmin, requireAdmin, serviceReady, services, settings, usageSummary } from './models';
import { invokeModel, ModelError } from './providers';
import { deleteObjects, releaseTask } from './store';
import type { Env } from './env';
import { deploymentDiagnostics, isDatabaseSchemaError } from './diagnostics';

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
export async function fetchApi(request: Request, env: Env): Promise<Response> {
  let response: Response;
  try {
    const user = await identify(request, env), url = new URL(request.url), method = request.method;
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) enforceOrigin(request);
    if (url.pathname === '/api/me' && method === 'GET') response = json({ email: user.email, local: user.local, role: isAdmin(env, user) ? 'admin' : 'member' });
    else if (url.pathname === '/api/models' && method === 'GET') response = json(await settings(env, user.email));
    else if (url.pathname === '/api/credentials' && method === 'POST') {
      const input = CredentialInputSchema.parse(await boundedJson(request, 10000));
      response = json(await saveCredential(env, user.email, input), 201);
    } else if (url.pathname === '/api/credentials/test' && method === 'POST') {
      const raw = await boundedJson(request, 10000);
      let config, key: string;
      const ref = z.object({ credentialId: z.uuid() }).strict().safeParse(raw);
      if (ref.success) { const row = await ownedCredential(env, ref.data.credentialId, user.email); config = JSON.parse(row.config); key = await decryptKey(env, row, user.email, row.id); }
      else { const input = CredentialInputSchema.parse(raw); config = input.config; key = input.apiKey; }
      if (!(await encryptionReady(env))) throw new HttpError(503, '管理员尚未配置个人密钥加密服务');
      await admitProbe(env, user.email);
      await invokeModel(env, config, key, 'Reply with OK. This is a connection test.', 'Hello', undefined, true);
      response = json({ ok: true, message: '所选模型连接成功。测试可能产生少量服务商费用。' });
    } else if (/^\/api\/credentials\/[0-9a-f-]{36}$/.test(url.pathname) && ['PUT', 'DELETE'].includes(method)) {
      const id = url.pathname.split('/').at(-1)!; await ownedCredential(env, id, user.email);
      if (method === 'PUT') response = json(await saveCredential(env, user.email, CredentialInputSchema.parse(await boundedJson(request, 10000)), id));
      else { await env.DB.prepare('DELETE FROM credentials WHERE id=? AND owner=?').bind(id, user.email).run(); response = json({ deleted: true }); }
    } else if (url.pathname.startsWith('/api/admin/')) {
      requireAdmin(env, user);
      if (url.pathname === '/api/admin/diagnostics' && method === 'GET') response = json(await deploymentDiagnostics(env));
      else if (url.pathname === '/api/admin/models' && method === 'GET') {
        const all = await services(env), policies = await env.DB.prepare('SELECT config FROM member_policies').all<{ config: string }>();
        const members = await env.DB.prepare('SELECT DISTINCT owner FROM admissions ORDER BY owner LIMIT 200').all<{ owner: string }>();
        response = json({ services: all.map(s => ({ ...s, ready: serviceReady(env, s) })), policies: policies.results.map(r => JSON.parse(r.config)), members: members.results.map(r => r.owner), usage: await usageSummary(env) });
      } else if (url.pathname === '/api/admin/models' && method === 'PUT') {
        const input = TeamServiceSchema.parse(await boundedJson(request, 10000));
        await env.DB.prepare('INSERT INTO team_services(id,config) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET config=excluded.config').bind(input.id, JSON.stringify(input)).run(); response = json({ saved: true });
      } else if (url.pathname === '/api/admin/policies' && method === 'PUT') {
        const input = MemberPolicySchema.parse(await boundedJson(request, 10000));
        await env.DB.prepare('INSERT INTO member_policies(email,config) VALUES(?,?) ON CONFLICT(email) DO UPDATE SET config=excluded.config').bind(input.email, JSON.stringify(input)).run(); response = json({ saved: true });
      } else throw new HttpError(404, '接口不存在');
    } else if (url.pathname === '/api/jobs' && method === 'GET') {
      const rows = await env.DB.prepare(`SELECT ${jobColumns} FROM jobs WHERE owner=? AND expires_at>? ORDER BY created_at DESC LIMIT 30`).bind(user.email, Date.now()).all(); response = json(rows.results);
    } else if (url.pathname === '/api/jobs' && method === 'POST') response = json(await createJob(env, user.email, await boundedJson(request)), 202);
    else {
      const match = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})(\/result)?$/);
      if (match && method === 'GET') {
        const job = await ownedJob(env, match[1], user.email);
        if (match[2]) {
          if (job.status !== 'completed') throw new HttpError(409, '任务尚未完成');
          const object = await env.FILES.get(`${job.id}/result.json`); if (!object) throw new HttpError(404, '结果已过期');
          response = new Response(object.body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
        } else response = json(job);
      } else if (match && !match[2] && method === 'DELETE') {
        const job = await ownedJob(env, match[1], user.email);
        if (['queued', 'running'].includes(job.status)) { const workflow = await env.EXTRACT.get(job.id); await workflow.terminate(); }
        await releaseTask(env, job.id); await deleteObjects(env, job.id);
        await env.DB.prepare('DELETE FROM jobs WHERE id=? AND owner=?').bind(job.id, user.email).run(); response = json({ deleted: true });
      } else if (url.pathname.startsWith('/api/')) throw new HttpError(404, '接口不存在');
      else response = await env.ASSETS.fetch(request);
    }
  } catch (error) {
    response = isDatabaseSchemaError(error) ? json({ error: '数据库迁移尚未完成，请管理员在 Cloudflare D1 控制台补齐迁移后重试', code: 'DATABASE_SCHEMA_INCOMPLETE' }, 503)
      : error instanceof HttpError ? json({ error: error.message, ...(error instanceof ModelError ? { retryable: error.retryable } : {}) }, error.status)
      : error instanceof z.ZodError ? json({ error: '配置无效，请检查模型能力、区域、工作空间及数值范围' }, 400) : json({ error: '服务暂时不可用，请联系管理员检查配置' }, 500);
  }
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff'); headers.set('Referrer-Policy', 'same-origin'); headers.set('X-Frame-Options', 'DENY');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  const local = ['localhost', '127.0.0.1'].includes(new URL(request.url).hostname);
  if (!local) headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  return new Response(response.body, { status: response.status, headers });
}

import { JobInputSchema, type Job } from '../shared/schema';
import { boundedJson, enforceOrigin, HttpError, identify } from './auth';
import type { Env } from './env';
export { ExtractionWorkflow } from './workflow';

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
async function ownedJob(env: Env, id: string, owner: string) {
  const job = await env.DB.prepare('SELECT id,name,status,progress,total,error,created_at FROM jobs WHERE id=? AND owner=? AND expires_at>?').bind(id, owner, Date.now()).first<Job>();
  if (!job) throw new HttpError(404, '任务不存在或已过期');
  return job;
}
export async function deleteObjects(env: Env, id: string) {
  let cursor: string | undefined;
  do {
    const page = await env.FILES.list({ prefix: `${id}/`, cursor });
    if (page.objects.length) await env.FILES.delete(page.objects.map(o => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let response: Response;
    try {
      const user = await identify(request, env), url = new URL(request.url);
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) enforceOrigin(request);
      if (url.pathname === '/api/me' && request.method === 'GET') response = json({ email: user.email, local: user.local, model: env.AI_MODEL });
      else if (url.pathname === '/api/jobs' && request.method === 'GET') {
        const rows = await env.DB.prepare('SELECT id,name,status,progress,total,error,created_at FROM jobs WHERE owner=? AND expires_at>? ORDER BY created_at DESC LIMIT 30').bind(user.email, Date.now()).all();
        response = json(rows.results);
      } else if (url.pathname === '/api/jobs' && request.method === 'POST') {
        const parsed = JobInputSchema.safeParse(await boundedJson(request));
        if (!parsed.success) throw new HttpError(400, '输入无效：最多 80 个片段、120000 字符，项目名称须为 1–100 字符');
        if (!parsed.data.segments.some(s => s.text.trim())) throw new HttpError(400, '输入没有文字');
        const id = crypto.randomUUID(), now = Date.now();
        // One atomic SQL statement prevents concurrent requests from bypassing quotas.
        const inserted = await env.DB.prepare(`INSERT INTO jobs(id,owner,name,status,created_at,expires_at)
          SELECT ?,?,?,'queued',?,? WHERE
          (SELECT COUNT(*) FROM jobs WHERE owner=? AND created_at>?) < 30 AND
          (SELECT COUNT(*) FROM jobs WHERE owner=? AND status IN ('queued','running')) < 2 AND
          (SELECT COUNT(*) FROM jobs WHERE created_at>?) < 200`).bind(id, user.email, parsed.data.name, now, now + 7 * 86400000, user.email, now - 86400000, user.email, now - 86400000).run();
        if (!inserted.meta.changes) throw new HttpError(429, '任务额度已满：每成员每天 30 个、同时 2 个，团队每天 200 个');
        try {
          await env.FILES.put(`${id}/input.json`, JSON.stringify(parsed.data));
          await env.EXTRACT.create({ id, params: { id } });
        } catch {
          await env.DB.prepare("UPDATE jobs SET status='failed',error='后台任务启动失败，请联系管理员' WHERE id=?").bind(id).run();
          await env.FILES.delete(`${id}/input.json`);
          throw new HttpError(503, '后台任务启动失败，请联系管理员');
        }
        response = json({ id }, 202);
      } else {
        const match = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})(\/result)?$/);
        if (match && request.method === 'GET') {
          const job = await ownedJob(env, match[1], user.email);
          if (match[2]) {
            if (job.status !== 'completed') throw new HttpError(409, '任务尚未完成');
            const object = await env.FILES.get(`${job.id}/result.json`);
            if (!object) throw new HttpError(404, '结果已过期');
            response = new Response(object.body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
          } else response = json(job);
        } else if (match && !match[2] && request.method === 'DELETE') {
          const job = await ownedJob(env, match[1], user.email);
          if (['queued', 'running'].includes(job.status)) {
            const workflow = await env.EXTRACT.get(job.id); await workflow.terminate();
          }
          await deleteObjects(env, job.id);
          await env.DB.prepare('DELETE FROM jobs WHERE id=? AND owner=?').bind(job.id, user.email).run();
          response = json({ deleted: true });
        } else if (url.pathname.startsWith('/api/')) throw new HttpError(404, '接口不存在');
        else response = await env.ASSETS.fetch(request);
      }
    } catch (error) {
      response = error instanceof HttpError ? json({ error: error.message }, error.status) : json({ error: '服务暂时不可用，请联系管理员检查配置' }, 500);
    }
    const headers = new Headers(response.headers);
    headers.set('X-Content-Type-Options', 'nosniff'); headers.set('Referrer-Policy', 'same-origin');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    const local = ['localhost', '127.0.0.1'].includes(new URL(request.url).hostname);
    if (!local) headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    return new Response(response.body, { status: response.status, headers });
  },
  async scheduled(_controller: ScheduledController, env: Env) {
    // Recover platform failures which prevented the workflow from recording its error.
    const stale = await env.DB.prepare("SELECT id FROM jobs WHERE status IN ('queued','running') AND created_at<? LIMIT 100").bind(Date.now() - 3 * 3600000).all<{ id: string }>();
    for (const job of stale.results) {
      const workflow = await env.EXTRACT.get(job.id);
      await workflow.terminate();
      await env.DB.prepare("UPDATE jobs SET status='failed',error='任务超时，请分批重试' WHERE id=?").bind(job.id).run();
      await deleteObjects(env, job.id);
    }
    const expired = await env.DB.prepare('SELECT id FROM jobs WHERE expires_at<? LIMIT 100').bind(Date.now()).all<{ id: string }>();
    for (const job of expired.results) {
      await deleteObjects(env, job.id);
      await env.DB.prepare('DELETE FROM jobs WHERE id=?').bind(job.id).run();
    }
  },
} satisfies ExportedHandler<Env>;

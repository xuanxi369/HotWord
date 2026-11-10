import type { Env } from './env';
import { fetchApi } from './http';
import { deleteObjects, releaseTask } from './store';
export { ExtractionWorkflow } from './workflow';

export default {
  fetch: fetchApi,
  async scheduled(_controller: ScheduledController, env: Env) {
    // Credential expiry does not depend on object storage or Workflow availability.
    await env.DB.batch([
      env.DB.prepare('DELETE FROM credentials WHERE expires_at IS NOT NULL AND expires_at<?').bind(Date.now()),
      env.DB.prepare('DELETE FROM job_secrets WHERE expires_at<?').bind(Date.now()),
    ]);
    const stale = await env.DB.prepare("SELECT id FROM jobs WHERE status IN ('queued','running') AND created_at<? LIMIT 100").bind(Date.now() - 3 * 3600000).all<{ id: string }>();
    for (const job of stale.results) {
      try { const workflow = await env.EXTRACT.get(job.id); await workflow.terminate(); } catch { /* A failed startup may have no Workflow instance. */ }
      await releaseTask(env, job.id);
      await env.DB.prepare("UPDATE jobs SET status='failed',error='任务超时，个人临时密钥已清理，请重新配置后分批重试' WHERE id=?").bind(job.id).run();
      await deleteObjects(env, job.id);
    }
    const expired = await env.DB.prepare('SELECT id FROM jobs WHERE expires_at<? LIMIT 100').bind(Date.now()).all<{ id: string }>();
    for (const job of expired.results) { await releaseTask(env, job.id); await deleteObjects(env, job.id); await env.DB.prepare('DELETE FROM jobs WHERE id=?').bind(job.id).run(); }
    await env.DB.batch([
      env.DB.prepare('DELETE FROM connection_probes WHERE created_at<?').bind(Date.now() - 86400000),
      env.DB.prepare('DELETE FROM admissions WHERE active=0 AND created_at<?').bind(Date.now() - 30 * 86400000),
      env.DB.prepare('DELETE FROM ai_usage WHERE created_at<?').bind(Date.now() - 30 * 86400000),
    ]);
  },
} satisfies ExportedHandler<Env>;

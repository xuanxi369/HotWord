import { JobCreateSchema, JobInputSchema, type Job, type JobInput } from '../shared/schema';
import { ModelConfigSchema, type ModelConfig } from '../shared/models';
import { chunkSegments } from '../shared/chunks';
import { auditChunks } from '../shared/table-audit';
import { callBudget, estimatedTermsPerChunk, modelPromptReserve } from './ai';
import { HttpError } from './auth';
import { credentialConfig, decryptKey, encryptKey, ownedCredential, type StoredCredential } from './credentials';
import { platformLimits, services, settings } from './models';
import { teamKey } from './providers';
import { deleteObjects, price, releaseTask, type Pricing } from './store';
import type { Env } from './env';
import { LanguagePairSchema, type LanguagePair } from '../shared/languages';

export const jobColumns = 'id,name,status,progress,total,error,created_at,mode,provider,model,service_name,input_tokens,output_tokens,estimated_usd,usage_estimated,language_pair';
export type StoredJob = Job & { language_pair?: string | null };
export function decodeJob(row: StoredJob): Job {
  const { language_pair, ...job } = row;
  return language_pair ? { ...job, languagePair: LanguagePairSchema.parse(JSON.parse(language_pair)) } : job;
}
export async function ownedJob(env: Env, id: string, owner: string) {
  const job = await env.DB.prepare(`SELECT ${jobColumns} FROM jobs WHERE id=? AND owner=? AND expires_at>?`).bind(id, owner, Date.now()).first<StoredJob>();
  if (!job) throw new HttpError(404, '任务不存在或已过期');
  return decodeJob(job);
}
export function chunkSize(config: ModelConfig, languagePair?: LanguagePair) {
  const size = Math.min(10000, Math.floor(config.maxOutputTokens * 0.75), config.contextWindow - config.maxOutputTokens - modelPromptReserve(languagePair) - 1024);
  if (size < 2) throw new HttpError(400, '模型上下文不足以容纳提取提示词和输出预算，请增大上下文长度或降低输出上限');
  return size;
}
export function extractionChunks(segments: JobInput['segments'], config: ModelConfig, auditCandidates?: JobInput['auditCandidates'], languagePair?: LanguagePair) {
  if (auditCandidates) return auditChunks(auditCandidates, chunkSize(config, languagePair), estimatedTermsPerChunk(config));
  // Reserve room for two candidates per bilingual row, including evidence.
  return chunkSegments(segments, chunkSize(config, languagePair), Math.max(1, Math.floor(estimatedTermsPerChunk(config) / 2)));
}
export async function createJob(env: Env, owner: string, raw: unknown) {
  const parsed = JobCreateSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, '输入无效，请检查模型配置、名称、片段数量及 120000 字符限制');
  const { selection } = parsed.data;
  const seeded = parsed.data.auditCandidates ?? parsed.data.translationCandidates;
  if (seeded && new Set(seeded.map(c => c.id)).size !== seeded.length) throw new HttpError(400, '核对词条 ID 重复');
  if (!parsed.data.segments.some(s => s.text.trim())) throw new HttpError(400, '输入没有文字');
  let config: ModelConfig, serviceName: string, pricing: Pricing = { input: null, output: null }, credential: StoredCredential | undefined, personalKey: string | undefined;
  if (selection.mode === 'team') {
    const service = (await services(env)).find(s => s.id === selection.serviceId && s.enabled);
    if (!service) throw new HttpError(400, '团队服务未开放，请手动选择其他服务');
    teamKey(env, service.config.provider);
    config = service.config; serviceName = service.name; pricing = { input: service.inputUsdPerMillion, output: service.outputUsdPerMillion };
  } else { credential = await ownedCredential(env, selection.credentialId, owner); config = credentialConfig(credential); serviceName = credential.name; personalKey = await decryptKey(env, credential, owner, credential.id); }
  let chunks;
  try { chunks = extractionChunks(parsed.data.segments, config, seeded, parsed.data.languagePair); }
  catch (e) { throw new HttpError(400, (e as Error).message); }
  // Keep per-call estimates for reporting; they do not gate task admission.
  const reserve = callBudget(config, chunks[0].text, parsed.data.languagePair);
  const reservedUsd = price(reserve, pricing), team = selection.mode === 'team';
  const id = crypto.randomUUID(), now = Date.now();
  // Admission and job creation share a D1 transaction.
  const admission = env.DB.prepare(`INSERT INTO admissions(id,owner,mode,credential_id,created_at,reserved_input,reserved_output,reserved_usd)
    SELECT ?,?,?,?,?,?,?,? WHERE
    (SELECT COUNT(*) FROM admissions WHERE owner=? AND active=1)<? AND
    (? IS NULL OR (EXISTS(SELECT 1 FROM credentials WHERE id=? AND owner=? AND (expires_at IS NULL OR expires_at>?) AND ciphertext=?) AND
      (?=1 OR NOT EXISTS(SELECT 1 FROM admissions WHERE credential_id=?))))`)
    .bind(id, owner, selection.mode, credential?.id ?? null, now, reserve.input, reserve.output, reservedUsd ?? 0,
      owner, platformLimits.concurrency,
      credential?.id ?? null, credential?.id ?? null, owner, now, credential?.ciphertext ?? '', credential?.remember ?? 0, credential?.id ?? null);
  const inserted = await env.DB.batch([admission, env.DB.prepare(`INSERT INTO jobs(id,owner,name,status,created_at,expires_at,mode,provider,model,service_name,model_config,service_id,credential_id,language_pair)
    SELECT ?,?,?,'queued',?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM admissions WHERE id=?)`)
    .bind(id, owner, parsed.data.name, now, now + 7 * 86400000, selection.mode, config.provider, config.model, serviceName, JSON.stringify({ config, pricing }), selection.mode === 'team' ? selection.serviceId : null, credential?.id ?? null, parsed.data.languagePair ? JSON.stringify(parsed.data.languagePair) : null, id)]);
  if (!inserted[0].meta.changes) {
    const available = (await settings(env, owner)).available;
    if (!available.concurrency) throw new HttpError(429, '同时运行的任务已达上限，请等待当前任务结束后重试');
    throw new HttpError(429, team ? '任务提交发生并发冲突，请刷新可用额度后重试' : '本次个人配置已被使用或过期，请重新配置个人密钥');
  }
  try {
    if (credential) {
      const sealed = await encryptKey(env, personalKey!, owner, id);
      await env.DB.batch([env.DB.prepare('INSERT INTO job_secrets(job_id,owner,ciphertext,nonce,expires_at) VALUES(?,?,?,?,?)').bind(id, owner, sealed.ciphertext, sealed.nonce, now + 3 * 3600000),
        env.DB.prepare('DELETE FROM credentials WHERE id=? AND owner=? AND remember=0').bind(credential.id, owner)]);
    }
    await env.FILES.put(`${id}/input.json`, JSON.stringify(JobInputSchema.parse(parsed.data)));
    await env.EXTRACT.create({ id, params: { id } });
  } catch {
    await releaseTask(env, id);
    await env.DB.prepare("UPDATE jobs SET status='failed',error='后台任务启动失败，请重新配置后重试或联系管理员' WHERE id=?").bind(id).run();
    await deleteObjects(env, id);
    throw new HttpError(503, '后台任务启动失败，请重新配置后重试或联系管理员');
  }
  return { id };
}
export type ExecutionJob = { id: string; owner: string; mode: 'team' | 'personal'; provider: ModelConfig['provider']; model: string; model_config: string | null; status: string };
export function executionConfig(env: Env, job: ExecutionJob): { config: ModelConfig; pricing: Pricing } {
  if (job.model_config) return JSON.parse(job.model_config);
  // Existing tasks created before migration retain their original Cloudflare route.
  return { config: ModelConfigSchema.parse({ provider: 'cloudflare', model: job.model || env.AI_MODEL, outputMode: 'json_schema', maxOutputTokens: 12000 }), pricing: { input: null, output: null } };
}

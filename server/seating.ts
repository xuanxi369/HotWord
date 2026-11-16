import { analyzeSchema, planSchema } from '../shared/seating/schema';
import { buildRoster, validateSheets } from '../shared/seating/roster';
import { PLAN_JSON_SCHEMA, SEATING_SYSTEM } from '../shared/seating/prompt';
import { visionUnavailable } from '../shared/vision';
import { HttpError } from './auth';
import { credentialConfig, decryptKey, ownedCredential } from './credentials';
import { platformLimits, services } from './models';
import { invokeModel, ModelError, parseModelJson, teamKey } from './providers';
import { price, recordUsage, releaseTask, type Pricing } from './store';
import type { Env } from './env';

export function validateSeatingImage(image: string) {
  const [prefix, data] = image.split(',');
  let bytes: string;
  try { bytes = atob(data); } catch { throw new HttpError(400, '图片编码无效，请重新上传'); }
  const valid = prefix === 'data:image/png;base64' && bytes.startsWith('\x89PNG\r\n\x1a\n')
    || prefix === 'data:image/jpeg;base64' && bytes.startsWith('\xff\xd8\xff')
    || prefix === 'data:image/webp;base64' && bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP';
  if (!valid) throw new HttpError(400, '图片格式与内容不一致，请重新上传 PNG、JPG 或 WebP');
}

/** Synchronous vision call: uses existing admissions/credentials/usage, never stores source files. */
export async function analyzeSeating(env: Env, owner: string, raw: unknown) {
  const checked = analyzeSchema.safeParse(raw);
  if (!checked.success) throw new HttpError(400, '座次资料格式无效或超过限制，请检查图片、工作表和模型选择');
  const input = checked.data, selection = input.selection;
  validateSeatingImage(input.image);
  try { validateSheets(input.sheets); } catch (error) { throw new HttpError(400, (error as Error).message); }
  const service = selection.mode === 'team' ? (await services(env)).find(item => item.id === selection.serviceId && item.enabled) : undefined;
  if (selection.mode === 'team' && !service) throw new HttpError(400, '团队服务未开放，请选择其他服务');
  const credential = selection.mode === 'personal' ? await ownedCredential(env, selection.credentialId, owner) : undefined;
  const config = service?.config ?? credentialConfig(credential!);
  const unsupported = visionUnavailable(config);
  if (unsupported) throw new HttpError(400, unsupported);
  const key = credential ? await decryptKey(env, credential, owner, credential.id) : teamKey(env, config.provider);
  const pricing: Pricing = { input: service?.inputUsdPerMillion ?? null, output: service?.outputUsdPerMillion ?? null };
  const text = JSON.stringify({ userNotes: input.notes, sheets: input.sheets });
  const budget = { input: SEATING_SYSTEM.length + text.length + 4352, output: config.maxOutputTokens };
  if (budget.input + budget.output >= config.contextWindow) throw new HttpError(400, '所选座次资料超出模型上下文预算，请减少参与分析的工作表，或选择更大上下文的视觉模型');
  const id = crypto.randomUUID(), now = Date.now();
  const admission = env.DB.prepare(`INSERT INTO admissions(id,owner,mode,credential_id,created_at,reserved_input,reserved_output,reserved_usd)
    SELECT ?,?,?,?,?,?,?,? WHERE
    (SELECT COUNT(*) FROM admissions WHERE owner=? AND active=1)<? AND
    (? IS NULL OR (EXISTS(SELECT 1 FROM credentials WHERE id=? AND owner=? AND (expires_at IS NULL OR expires_at>?) AND ciphertext=?) AND
      (?=1 OR NOT EXISTS(SELECT 1 FROM admissions WHERE credential_id=?))))`)
    .bind(id, owner, selection.mode, credential?.id ?? null, now, budget.input, budget.output, price(budget, pricing) ?? 0,
      owner, platformLimits.concurrency, credential?.id ?? null, credential?.id ?? null, owner, now, credential?.ciphertext ?? '', credential?.remember ?? 0, credential?.id ?? null);
  const statements = [admission];
  if (credential && !credential.remember) statements.push(env.DB.prepare('DELETE FROM credentials WHERE id=? AND owner=? AND EXISTS(SELECT 1 FROM admissions WHERE id=?)').bind(credential.id, owner, id));
  const inserted = await env.DB.batch(statements);
  if (!inserted[0].meta.changes) throw new HttpError(429, '同时运行的任务已达上限，或本次个人配置已使用、过期，请等待或重新配置');
  const job = { id, owner, mode: selection.mode, provider: config.provider, model: config.model };
  try {
    let reply;
    try { reply = await invokeModel(env, config, key, SEATING_SYSTEM, text, PLAN_JSON_SCHEMA, false, { image: input.image, timeoutMs: 90_000, schemaName: 'seating_plan' }); }
    catch (error) { if (error instanceof ModelError && error.usage) await recordUsage(env, job, pricing, error.usage); throw error; }
    // Bill a completed call even if its plan fails validation; never return partial data.
    await recordUsage(env, job, pricing, reply.usage);
    const parsed = planSchema.safeParse(parseModelJson(reply.value, reply.usage));
    if (!parsed.success) throw new HttpError(422, 'AI 返回的分区结构不完整，请调整输出容量、重试或使用手动分区');
    try {
      const review = buildRoster(parsed.data, input.sheets);
      if (review.errors.length) throw new Error(review.errors[0]);
    } catch (error) { throw new HttpError(422, 'AI 分区引用无效，请重试或手动调整：' + (error as Error).message); }
    return { plan: parsed.data, provider: service?.name ?? credential!.name, model: config.model };
  } finally { await releaseTask(env, id); }
}

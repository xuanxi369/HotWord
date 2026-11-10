import { z } from 'zod';
import { ModelConfigSchema, type Credential, type ModelConfig } from '../shared/models';
import { HttpError } from './auth';
import type { Env } from './env';

export const CredentialInputSchema = z.object({
  name: z.string().trim().min(1).max(80), config: ModelConfigSchema,
  apiKey: z.string().trim().min(8).max(1024).regex(/^[\x21-\x7e]+$/), remember: z.boolean().default(false),
}).strict().refine(v => v.config.provider !== 'cloudflare', '个人服务不使用 Cloudflare binding');
export type StoredCredential = { id: string; owner: string; name: string; masked_key: string; config: string; ciphertext: string; nonce: string; remember: number; created_at: number; expires_at: number | null };
function encode(data: Uint8Array) { return btoa(String.fromCharCode(...data)); }
function decode(data: string) { return Uint8Array.from(atob(data), c => c.charCodeAt(0)); }
async function masterKey(env: Env) {
  try {
    const bytes = decode(env.CREDENTIAL_ENCRYPTION_KEY ?? '');
    if (bytes.length !== 32) throw new Error();
    return await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
  } catch { throw new HttpError(503, '管理员尚未配置个人密钥加密服务'); }
}
export async function encryptionReady(env: Env) { try { await masterKey(env); return true; } catch { return false; } }
export async function encryptKey(env: Env, key: string, owner: string, reference: string) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: new TextEncoder().encode(`${owner}:${reference}`) }, await masterKey(env), new TextEncoder().encode(key));
  return { ciphertext: encode(new Uint8Array(encrypted)), nonce: encode(nonce) };
}
export async function decryptKey(env: Env, value: { ciphertext: string; nonce: string }, owner: string, reference: string) {
  try {
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(value.nonce), additionalData: new TextEncoder().encode(`${owner}:${reference}`) }, await masterKey(env), decode(value.ciphertext)));
  } catch { throw new HttpError(503, '个人密钥无法解密，请重新配置或联系管理员'); }
}
export function publicCredential(row: StoredCredential): Credential {
  return { id: row.id, name: row.name, masked_key: row.masked_key, config: ModelConfigSchema.parse(JSON.parse(row.config)), remember: !!row.remember, created_at: row.created_at, expires_at: row.expires_at };
}
export async function ownedCredential(env: Env, id: string, owner: string) {
  const row = await env.DB.prepare('SELECT * FROM credentials WHERE id=? AND owner=? AND (expires_at IS NULL OR expires_at>?)').bind(id, owner, Date.now()).first<StoredCredential>();
  if (!row) throw new HttpError(404, '个人配置不存在或已过期，请重新配置');
  return row;
}
export async function saveCredential(env: Env, owner: string, input: z.infer<typeof CredentialInputSchema>, id = crypto.randomUUID() as string) {
  const sealed = await encryptKey(env, input.apiKey, owner, id);
  const expires = input.remember ? null : Date.now() + 3600000;
  const result = await env.DB.prepare(`INSERT INTO credentials(id,owner,name,masked_key,config,ciphertext,nonce,remember,created_at,expires_at)
    SELECT ?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM credentials WHERE owner=? AND (expires_at IS NULL OR expires_at>?))<20
      OR EXISTS(SELECT 1 FROM credentials WHERE id=? AND owner=?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,masked_key=excluded.masked_key,config=excluded.config,ciphertext=excluded.ciphertext,nonce=excluded.nonce,remember=excluded.remember,expires_at=excluded.expires_at WHERE credentials.owner=excluded.owner`)
    .bind(id, owner, input.name, `••••${input.apiKey.slice(-4)}`, JSON.stringify(input.config), sealed.ciphertext, sealed.nonce, input.remember ? 1 : 0, Date.now(), expires, owner, Date.now(), id, owner).run();
  if (!result.meta.changes) throw new HttpError(429, '个人配置最多 20 项，请先删除不再使用的配置');
  return publicCredential(await ownedCredential(env, id, owner));
}
export async function taskKey(env: Env, id: string, owner: string): Promise<string> {
  const row = await env.DB.prepare('SELECT ciphertext,nonce FROM job_secrets WHERE job_id=? AND owner=? AND expires_at>?').bind(id, owner, Date.now()).first<{ ciphertext: string; nonce: string }>();
  if (!row) throw new HttpError(410, '任务个人密钥已清理或过期，请重新配置后提交任务');
  return decryptKey(env, row, owner, id);
}
export function credentialConfig(row: StoredCredential): ModelConfig { return ModelConfigSchema.parse(JSON.parse(row.config)); }

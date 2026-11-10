import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Env } from './env';

const keysets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function identify(request: Request, env: Env): Promise<{ email: string; local: boolean }> {
  const hostname = new URL(request.url).hostname;
  if (env.AUTH_MODE === 'local' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return { email: 'local@development', local: true };
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN) || !env.ACCESS_AUD) throw new HttpError(503, '管理员尚未完成团队登录配置');
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw new HttpError(401, '请先通过团队成员登录');
  const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
  if (!keysets.has(issuer)) keysets.set(issuer, createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)));
  try {
    const { payload } = await jwtVerify(token, keysets.get(issuer)!, { issuer, audience: env.ACCESS_AUD, algorithms: ['RS256'] });
    if (typeof payload.email !== 'string' || !payload.email || typeof payload.exp !== 'number') throw new Error('Missing identity');
    return { email: payload.email.toLowerCase(), local: false };
  } catch { throw new HttpError(401, '成员登录已失效，请重新登录'); }
}
export function enforceOrigin(request: Request) {
  if (request.headers.get('Origin') !== new URL(request.url).origin) throw new HttpError(403, '请求来源不匹配');
}
export async function boundedJson(request: Request, limit = 700_000): Promise<unknown> {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new HttpError(415, '只接受 JSON 请求');
  if (!request.body) throw new HttpError(400, '请求内容为空');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let bytes = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    bytes += value.byteLength;
    if (bytes > limit) { await reader.cancel(); throw new HttpError(413, '解析文本过大，请分批处理'); }
    chunks.push(value);
  }
  const joined = new Uint8Array(bytes); let offset = 0;
  for (const c of chunks) { joined.set(c, offset); offset += c.length; }
  try { return JSON.parse(new TextDecoder().decode(joined)); }
  catch { throw new HttpError(400, '请求内容不是有效 JSON'); }
}

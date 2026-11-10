import { beforeAll, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { boundedJson, enforceOrigin, identify } from '../server/auth';
import type { Env } from '../server/env';
import { fetchApi } from '../server/http';
import { testEnv } from './support/database';
const state = vi.hoisted(() => ({ jwk: {} as Record<string, unknown> }));
vi.mock('jose', async importOriginal => {
  const jose = await importOriginal<typeof import('jose')>();
  return { ...jose, createRemoteJWKSet: () => jose.createLocalJWKSet({ keys: [state.jwk] }) };
});
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
const env = { AUTH_MODE: 'access', ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com', ACCESS_AUD: 'test-audience' } as Env;
const request = (token?: string, url = 'https://terms.example.com/api/jobs') => new Request(url, { headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {} });
async function token(aud = 'test-audience', exp = Math.floor(Date.now() / 1000) + 600) {
  return new SignJWT({ email: 'member@example.com' }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer('https://example.cloudflareaccess.com').setAudience(aud).setExpirationTime(exp).sign(keys.privateKey);
}
beforeAll(async () => { keys = await generateKeyPair('RS256'); state.jwk = { ...(await exportJWK(keys.publicKey)), kid: 'test-key', alg: 'RS256' }; });
describe('成员身份与请求保护', () => {
  it('真实 JWT 成员无管理员权限，管理员由服务端邮箱名单指定', async () => {
    const runtime = { ...testEnv().env, ...env, ADMIN_EMAILS: 'admin@example.com' };
    expect((await fetchApi(request(await token(), 'https://terms.example.com/api/admin/models'), runtime)).status).toBe(403);
    const me = await fetchApi(request(await token(), 'https://terms.example.com/api/me'), runtime);
    expect(await me.json()).toMatchObject({ email: 'member@example.com', role: 'member' });
  });
  it('验证签名、应用 audience 和过期时间', async () => {
    expect(await identify(request(await token()), env)).toEqual({ email: 'member@example.com', local: false });
    await expect(identify(request(await token('other-app')), env)).rejects.toMatchObject({ status: 401 });
    await expect(identify(request(await token('test-audience', 1)), env)).rejects.toMatchObject({ status: 401 });
  });
  it('伪造邮箱头与匿名访问均不能作为成员', async () => {
    await expect(identify(new Request('https://terms.example.com', { headers: { 'Cf-Access-Authenticated-User-Email': 'admin@example.com' } }), env)).rejects.toMatchObject({ status: 401 });
    await expect(identify(request('a.b.c'), env)).rejects.toMatchObject({ status: 401 });
  });
  it('本地绕过模式不能在公开域名开启', async () => {
    expect(await identify(request(undefined, 'http://localhost:5173'), { ...env, AUTH_MODE: 'local' })).toMatchObject({ local: true });
    await expect(identify(request(), { ...env, AUTH_MODE: 'local' })).rejects.toMatchObject({ status: 401 });
  });
  it('未配置团队登录时拒绝所有请求', async () => {
    await expect(identify(request(), { ...env, ACCESS_AUD: '' })).rejects.toMatchObject({ status: 503 });
  });
  it('跨站 POST 即使已登录也不能创建收费任务', () => {
    expect(() => enforceOrigin(new Request('https://terms.example.com/api/jobs', { method: 'POST', headers: { Origin: 'https://evil.example' } }))).toThrow();
    expect(() => enforceOrigin(new Request('https://terms.example.com/api/jobs', { method: 'POST', headers: { Origin: 'https://terms.example.com' } }))).not.toThrow();
  });
  it('无 Content-Length 的流也受到大小限制，损坏 JSON 被拒绝', async () => {
    await expect(boundedJson(new Request('https://terms.example.com/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(500) }), 100)).rejects.toMatchObject({ status: 413 });
    await expect(boundedJson(new Request('https://terms.example.com/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not-json' }))).rejects.toMatchObject({ status: 400 });
  });
});

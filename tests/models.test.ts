import { afterEach, describe, expect, it, vi } from 'vitest';
import { createJob } from '../server/jobs';
import { decryptKey, encryptKey, ownedCredential, saveCredential, taskKey } from '../server/credentials';
import { fetchApi } from '../server/http';
import { isAdmin, settings } from '../server/models';
import { recordUsage, releaseTask } from '../server/store';
import { modelDefaults } from '../shared/models';
import { testEnv } from './support/database';

const owner = 'local@development';
const input = { name: '双语测试', segments: [{ id: 'p', label: '第 1 页', text: 'Somnia-梦境公链，Industrial Collaboration-产业协同' }] };
const personal = (remember = false) => ({ name: '我的模型', config: modelDefaults('openai'), apiKey: 'personal-secret-value', remember });
const request = (path: string, method = 'GET', value?: unknown, origin = 'http://localhost') => new Request(`http://localhost${path}`, { method, headers: { Origin: origin, 'Content-Type': 'application/json' }, body: value === undefined ? undefined : JSON.stringify(value) });
afterEach(() => vi.unstubAllGlobals());
describe('加密凭据与成员隔离', () => {
  it('AES-GCM 绑定成员和凭据引用，错误主密钥不能解密', async () => {
    const { env } = testEnv(), sealed = await encryptKey(env, 'private-key', owner, 'ref');
    expect(sealed.ciphertext).not.toContain('private-key'); expect(await decryptKey(env, sealed, owner, 'ref')).toBe('private-key');
    await expect(decryptKey(env, sealed, 'other@example.com', 'ref')).rejects.toThrow();
    await expect(decryptKey(env, sealed, owner, 'other-ref')).rejects.toThrow();
    await expect(decryptKey({ ...env, CREDENTIAL_ENCRYPTION_KEY: btoa('different1234567different1234567') }, sealed, owner, 'ref')).rejects.toThrow();
  });
  it('个人密钥只返回脱敏配置，其他成员无法读取、替换或删除', async () => {
    const { env, sqlite } = testEnv();
    const saved = await saveCredential(env, 'other@example.com', personal(true));
    await expect(ownedCredential(env, saved.id, owner)).rejects.toMatchObject({ status: 404 });
    for (const method of ['PUT', 'DELETE']) expect((await fetchApi(request(`/api/credentials/${saved.id}`, method, method === 'PUT' ? personal() : undefined), env)).status).toBe(404);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM credentials').get()?.n).toBe(1);
    const mine = await saveCredential(env, owner, personal());
    const response = await fetchApi(request('/api/models'), env), body = await response.text();
    expect(body).toContain(mine.masked_key); expect(body).not.toContain(personal().apiKey); expect(body).not.toContain('ciphertext'); expect(body).not.toContain(env.OPENAI_API_KEY!);
  });
  it('未配置加密主密钥时关闭个人入口，临时配置过期后不可用', async () => {
    const { env, sqlite } = testEnv(); expect((await settings({ ...env, CREDENTIAL_ENCRYPTION_KEY: '' }, owner)).personalReady).toBe(false);
    const c = await saveCredential(env, owner, personal()); sqlite.prepare('UPDATE credentials SET expires_at=1 WHERE id=?').run(c.id);
    await expect(ownedCredential(env, c.id, owner)).rejects.toMatchObject({ status: 404 });
  });
});
describe('任务快照、原子额度与费用归属', () => {
  it('个人配置上限是原子 SQL，已有配置在满额时仍可更换', async () => {
    const { env, sqlite } = testEnv();
    const results = await Promise.allSettled(Array.from({ length: 21 }, () => saveCredential(env, owner, personal(true))));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(20);
    const first = results.find(r => r.status === 'fulfilled'); if (first?.status !== 'fulfilled') throw new Error('fixture');
    await saveCredential(env, owner, { ...personal(true), apiKey: 'replacement-key' }, first.value.id);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM credentials').get()?.n).toBe(20);
  });
  it('并发提交同一个仅一次密钥只能创建一个任务', async () => {
    const { env } = testEnv(), c = await saveCredential(env, owner, personal());
    const results = await Promise.allSettled(Array.from({ length: 2 }, () => createJob(env, owner, { ...input, selection: { mode: 'personal', credentialId: c.id } })));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('任务启动失败仍清理任务副本与输入，释放并发', async () => {
    const { env, sqlite, objects } = testEnv(), c = await saveCredential(env, owner, personal());
    env.EXTRACT.create = vi.fn().mockRejectedValue(new Error('platform failure'));
    await expect(createJob(env, owner, { ...input, selection: { mode: 'personal', credentialId: c.id } })).rejects.toMatchObject({ status: 503 });
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM job_secrets').get()?.n).toBe(0);
    expect(sqlite.prepare('SELECT active FROM admissions').get()?.active).toBe(0); expect([...objects.keys()]).toHaveLength(0);
  });
  it('用量持续记录，每日额度显示不限，结束后释放并发', async () => {
    const { env } = testEnv(); env.TEAM_SERVICES = JSON.stringify([{ id: 'openai', name: '团队模型', config: modelDefaults('openai'), inputUsdPerMillion: 1, outputUsdPerMillion: 2 }]);
    const job = await createJob(env, owner, { ...input, selection: { mode: 'team', serviceId: 'openai' } });
    const pending = await settings(env, owner); expect(pending.available.teamOutput).toBeNull(); expect(pending.available.concurrency).toBe(1);
    await recordUsage(env, { id: job.id, owner, mode: 'team', provider: 'openai', model: 'gpt-4.1-mini' }, { input: 1, output: 2 }, { input: 100, output: 40, estimated: false });
    await releaseTask(env, job.id); const done = await settings(env, owner); expect(done.available.teamOutput).toBeNull(); expect(done.available.teamTasks).toBeNull(); expect(done.available.concurrency).toBe(2);
    expect(done.usage.find(r => r.mode === 'team')?.output_tokens).toBe(40);
  });
  it('仅一次个人密钥提交后删除草稿，Workflow 只收到任务 ID，R2 不包含密钥', async () => {
    const { env, objects, starts, sqlite } = testEnv(); const c = await saveCredential(env, owner, personal());
    const job = await createJob(env, owner, { ...input, selection: { mode: 'personal', credentialId: c.id } });
    expect(starts).toEqual([job.id]); expect(sqlite.prepare('SELECT COUNT(*) AS n FROM credentials').get()?.n).toBe(0);
    expect(await taskKey(env, job.id, owner)).toBe(personal().apiKey); expect(objects.get(`${job.id}/input.json`)).not.toContain(personal().apiKey);
    expect(objects.get(`${job.id}/input.json`)).not.toContain('credentialId');
    await releaseTask(env, job.id); await expect(taskKey(env, job.id, owner)).rejects.toMatchObject({ status: 410 });
  });
  it('记住的密钥可复用，更换或删除不改变已提交的任务', async () => {
    const { env, sqlite } = testEnv(); const c = await saveCredential(env, owner, personal(true));
    const job = await createJob(env, owner, { ...input, selection: { mode: 'personal', credentialId: c.id } });
    await saveCredential(env, owner, { ...personal(true), apiKey: 'replacement-key', config: modelDefaults('deepseek') }, c.id);
    sqlite.prepare('DELETE FROM credentials WHERE id=?').run(c.id);
    expect(await taskKey(env, job.id, owner)).toBe(personal().apiKey);
    expect(sqlite.prepare('SELECT provider,model FROM jobs WHERE id=?').get(job.id)).toMatchObject({ provider: 'openai', model: 'gpt-4.1-mini' });
  });
  it('个人调用保留独立归属，两种模式仍受同一个并发限额', async () => {
    const { env, sqlite } = testEnv(); sqlite.prepare('INSERT INTO member_policies VALUES(?,?)').run(owner, JSON.stringify({ email: owner, teamDailyTasks: 0 }));
    const c = await saveCredential(env, owner, personal(true));
    const jobs = await Promise.allSettled(Array.from({ length: 3 }, () => createJob(env, owner, { ...input, selection: { mode: 'personal', credentialId: c.id } })));
    expect(jobs.filter(j => j.status === 'fulfilled')).toHaveLength(2); expect(jobs.filter(j => j.status === 'rejected')).toHaveLength(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM admissions WHERE mode='team'").get()?.n).toBe(0);
  });
  it('删除任务清理密钥并释放并发，保留历史用量记录', async () => {
    const { env, sqlite, terminated } = testEnv(); const c = await saveCredential(env, owner, personal(true));
    const job = await createJob(env, owner, { ...input, selection: { mode: 'personal', credentialId: c.id } });
    expect((await fetchApi(request(`/api/jobs/${job.id}`, 'DELETE'), env)).status).toBe(200); expect(terminated).toEqual([job.id]);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM job_secrets').get()?.n).toBe(0);
    expect(sqlite.prepare('SELECT active FROM admissions WHERE id=?').get(job.id)?.active).toBe(0);
    expect((await settings(env, owner)).usage.find(u => u.mode === 'personal')?.tasks).toBe(1);
  });
  it('旧 Token 和金额限制及未计价不阻断调用，关闭的服务仍不可调用', async () => {
    const { env, sqlite } = testEnv();
    const svc = { id: 'openai', name: '团队 OpenAI', enabled: true, config: modelDefaults('openai'), inputUsdPerMillion: 1, outputUsdPerMillion: 2 };
    env.TEAM_SERVICES = JSON.stringify([svc]);
    sqlite.prepare('INSERT INTO member_policies VALUES(?,?)').run(owner, JSON.stringify({ email: owner, teamDailyTasks: 0, teamDailyInput: 0, teamDailyOutput: 1, teamDailyUsd: 0.00001 }));
    const first = await createJob(env, owner, { ...input, selection: { mode: 'team', serviceId: 'openai' } });
    await releaseTask(env, first.id);
    env.TEAM_SERVICES = JSON.stringify([{ ...svc, inputUsdPerMillion: null }]);
    const second = await createJob(env, owner, { ...input, selection: { mode: 'team', serviceId: 'openai' } });
    await releaseTask(env, second.id);
    env.TEAM_SERVICES = JSON.stringify([{ ...svc, enabled: false }]);
    await expect(createJob(env, owner, { ...input, selection: { mode: 'team', serviceId: 'openai' } })).rejects.toMatchObject({ status: 400 });
  });
  it('跨站修改被拒绝，管理员不能由客户端提交身份，任务归属不可伪造', async () => {
    const { env } = testEnv(); expect((await fetchApi(request('/api/credentials', 'POST', personal(), 'https://evil.example'), env)).status).toBe(403);
    expect(isAdmin({ ...env, ADMIN_EMAILS: 'admin@example.com' }, { email: 'member@example.com', local: false })).toBe(false);
    expect(isAdmin({ ...env, ADMIN_EMAILS: 'ADMIN@example.com' }, { email: 'admin@example.com', local: false })).toBe(true);
    const c = await saveCredential(env, 'other@example.com', personal(true));
    await expect(createJob(env, owner, { ...input, selection: { mode: 'personal', credentialId: c.id } })).rejects.toMatchObject({ status: 404 });
  });
});

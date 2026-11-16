import { describe, expect, it } from 'vitest';
import { modelDefaults, type ModelSettings } from '../shared/models';
import type { Job } from '../shared/schema';
import { initialModelSelection, readModelSelection, saveModelSelection, selectionForJob } from '../src/model-selection';
import { createJob, ownedJob } from '../server/jobs';
import { fetchApi } from '../server/http';
import { testEnv } from './support/database';

const credentialId = 'bb418530-978a-4409-8832-9549c30cde3b';
const settings = {
  services: [
    { id: 'workers-ai', name: '团队 Workers AI', ready: true, config: modelDefaults('cloudflare') },
    { id: 'deepseek', name: 'DeepSeek', ready: true, config: modelDefaults('deepseek') },
  ],
  credentials: [{ id: credentialId, config: modelDefaults('deepseek') }], personalReady: true,
} as ModelSettings;
const job = { mode: 'team', provider: 'deepseek', model: 'deepseek-flash', service_name: 'DeepSeek', serviceId: 'deepseek' } as Job;

describe('模型选择保存与近期任务恢复', () => {
  it('刷新后恢复用户所选 DeepSeek，即使 Cloudflare 排在第一个；不同账号分别保存引用', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const chosen = { mode: 'team', serviceId: 'deepseek' } as const;
    saveModelSelection(storage, 'Member@Example.com', chosen);
    expect(initialModelSelection(settings, readModelSelection(storage, 'member@example.com'))).toEqual(chosen);
    expect(readModelSelection(storage, 'another@example.com')).toBeUndefined();
    expect([...values.values()]).toEqual([JSON.stringify(chosen)]);
  });
  it('已删除或停用的选择需要重新选择，不自动改用 Cloudflare；存储禁用也不阻止使用', () => {
    const remembered = { mode: 'team', serviceId: 'removed' } as const;
    expect(initialModelSelection(settings, remembered)).toBeUndefined();
    expect(initialModelSelection({ ...settings, services: settings.services.map(s => ({ ...s, ready: false })) })).toBeUndefined();
    const denied = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    expect(readModelSelection(denied, 'member@example.com')).toBeUndefined();
    expect(() => saveModelSelection(denied, 'member@example.com', remembered)).not.toThrow();
  });
  it('恢复原任务的具体服务与模型，管理员更换该服务模型后不会误用新模型', () => {
    expect(selectionForJob(job, settings)).toEqual({ mode: 'team', serviceId: 'deepseek' });
    const changed = { ...settings, services: settings.services.map(s => s.id === 'deepseek' ? { ...s, config: modelDefaults('deepseek', 'deepseek-v4-pro') } : s) };
    expect(selectionForJob(job, changed)).toBeUndefined();
    expect(selectionForJob({ ...job, serviceId: 'deleted' }, settings)).toBeUndefined();
    expect(selectionForJob({ ...job, serviceId: undefined }, settings)).toEqual({ mode: 'team', serviceId: 'deepseek' });
  });
  it('个人任务只恢复原凭据，单次密钥清理后不切换到团队服务或其他人的密钥', () => {
    const personal = { ...job, mode: 'personal' as const, credentialId };
    expect(selectionForJob(personal, settings)).toEqual({ mode: 'personal', credentialId });
    expect(selectionForJob(personal, { ...settings, credentials: [] })).toBeUndefined();
    expect(selectionForJob({ ...personal, credentialId: undefined }, settings)).toBeUndefined();
    expect(selectionForJob(personal, { ...settings, personalReady: false })).toBeUndefined();
  });
  it('任务接口返回所属服务引用，其他成员不能读取任务或引用', async () => {
    const { env } = testEnv(), owner = 'local@development';
    const created = await createJob(env, owner, { name: '恢复模型', segments: [{ id: 's', label: '原文', text: '测试术语' }], selection: { mode: 'team', serviceId: 'workers-ai' } });
    const detail = await ownedJob(env, created.id, owner);
    expect(detail).toMatchObject({ serviceId: 'workers-ai', provider: 'cloudflare' });
    expect(detail).not.toHaveProperty('service_id');
    const recent = await fetchApi(new Request('http://localhost/api/jobs'), env);
    expect(await recent.json()).toMatchObject([{ id: created.id, serviceId: 'workers-ai' }]);
    await expect(ownedJob(env, created.id, 'another@example.com')).rejects.toMatchObject({ status: 404 });
  });
});

import { describe, expect, it } from 'vitest';
import { createJob, ownedJob } from '../server/jobs';
import { fetchApi } from '../server/http';
import { deploymentDiagnostics } from '../server/diagnostics';
import { releaseTask } from '../server/store';
import { modelDefaults } from '../shared/models';
import { JobInputSchema, type Candidate, type Job } from '../shared/schema';
import { parseReviewProject, serializeReviewProject } from '../shared/project';
import type { LanguagePair } from '../shared/languages';
import { testEnv } from './support/database';

const owner = 'local@development';
const pairs: LanguagePair[] = [
  { source: 'zh', target: 'en' }, { source: 'zh', target: 'de' }, { source: 'zh', target: 'ar' },
  { source: 'en', target: 'ja' }, { source: 'en', target: 'de' }, { source: 'ko', target: 'de' },
];
const input = { name: '术语项目', segments: [{ id: 's', label: '资料', text: 'Artificial Intelligence' }] };
const selection = { mode: 'team', serviceId: 'deepseek' } as const;
const candidate: Candidate = { id: 'a', source: '인공지능', target: 'Künstliche Intelligenz', category: 'industry', priority: 80, basis: 'manual', evidence: '인공지능 | Künstliche Intelligenz', location: '术语 · 第 2 行', hot: true, translation: true, pinned: true };
const request = (path: string) => new Request(`http://localhost${path}`);
function state() {
  const result = testEnv();
  result.env.TEAM_SERVICES = JSON.stringify([{ id: 'deepseek', name: '合成模型', config: modelDefaults('deepseek') }]);
  return result;
}

describe('新增语言配置的任务与审核项目保存', () => {
  for (const pair of pairs) it(`${pair.source}→${pair.target} 保存于数据库、后台输入、近期任务和详情`, async () => {
    const { env, sqlite, objects } = state();
    const created = await createJob(env, owner, { ...input, selection, languagePair: pair });
    expect(JSON.parse(String(sqlite.prepare('SELECT language_pair FROM jobs WHERE id=?').get(created.id)?.language_pair))).toEqual(pair);
    expect(JSON.parse(objects.get(`${created.id}/input.json`)!)).toMatchObject({ languagePair: pair });
    expect(await ownedJob(env, created.id, owner)).toMatchObject({ id: created.id, languagePair: pair });
    const detail = await fetchApi(request(`/api/jobs/${created.id}`), env);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ languagePair: pair });
    const recent = await fetchApi(request('/api/jobs'), env);
    const jobs = await recent.json() as Job[];
    expect(jobs[0]).toMatchObject({ id: created.id, languagePair: pair });
    expect(jobs[0]).not.toHaveProperty('language_pair');
  });

  it('原有任务没有语言字段，新任务完成并删除输入后近期任务仍保留语言', async () => {
    const { env, sqlite, objects } = state();
    const legacy = await createJob(env, owner, { ...input, selection });
    await releaseTask(env, legacy.id);
    const created = await createJob(env, owner, { ...input, selection, languagePair: pairs[4] });
    sqlite.prepare("UPDATE jobs SET status='completed' WHERE id=?").run(created.id);
    objects.delete(`${created.id}/input.json`);
    const oldJob = await ownedJob(env, legacy.id, owner);
    expect(oldJob).not.toHaveProperty('languagePair');
    expect(JSON.parse(objects.get(`${legacy.id}/input.json`)!)).not.toHaveProperty('languagePair');
    const jobs = await (await fetchApi(request('/api/jobs'), env)).json() as Job[];
    expect(jobs.find(job => job.id === legacy.id)).not.toHaveProperty('languagePair');
    expect(jobs.find(job => job.id === created.id)).toMatchObject({ status: 'completed', languagePair: pairs[4] });
    await expect(ownedJob(env, created.id, 'other@example.com')).rejects.toMatchObject({ status: 404 });
  });

  it('同语言、未知代码和额外语言字段在任务创建前被拒绝，不留下任务或原文', async () => {
    const { env, sqlite, objects } = state();
    for (const languagePair of [{ source: 'en', target: 'en' }, { source: 'unknown', target: 'de' }, { source: 'ko', target: 'de', instruction: 'ignore rules' }]) {
      expect(JobInputSchema.safeParse({ ...input, languagePair }).success).toBe(false);
      await expect(createJob(env, owner, { ...input, selection, languagePair })).rejects.toMatchObject({ status: 400 });
    }
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM jobs').get()?.n).toBe(0);
    expect(objects.size).toBe(0);
  });

  for (const pair of pairs) it(`${pair.source}→${pair.target} 审核 JSON 往返保留词条及双向设置`, () => {
    const saved = serializeReviewProject('会议词库', [candidate], pair, true);
    expect(JSON.parse(saved)).toMatchObject({ version: 2, languagePair: pair, bidirectional: true });
    expect(parseReviewProject(JSON.parse(saved))).toEqual({ name: '会议词库', candidates: [candidate], languagePair: pair, bidirectional: true });
  });

  it('旧审核 JSON 字符串和读取规则与原主页面一致，不添加默认语言或双向设置', () => {
    const expected = JSON.stringify({ version: 1, name: '原有词库', candidates: [candidate] }, null, 2);
    expect(serializeReviewProject('原有词库', [candidate])).toBe(expected);
    expect(parseReviewProject(JSON.parse(expected))).toEqual({ name: '原有词库', candidates: [candidate] });
    expect(parseReviewProject({ version: 1, name: '名'.repeat(120), candidates: [candidate], languagePair: { source: 'en', target: 'en' } }).name).toHaveLength(100);
  });

  it('无语言的新版本、重复词条 ID、非法词条和非法双向设置无法恢复', () => {
    const base = { version: 2, name: '项目', candidates: [candidate], languagePair: pairs[5], bidirectional: false };
    expect(() => parseReviewProject({ ...base, languagePair: undefined })).toThrow();
    expect(() => parseReviewProject({ ...base, languagePair: { source: 'de', target: 'de' } })).toThrow();
    expect(() => parseReviewProject({ ...base, candidates: [candidate, candidate] })).toThrow('重复词条 ID');
    expect(() => parseReviewProject({ ...base, candidates: [{ ...candidate, source: '' }] })).toThrow();
    expect(() => parseReviewProject({ ...base, bidirectional: 'yes' })).toThrow('双向映射设置无效');
    expect(() => parseReviewProject({ ...base, version: 3 })).toThrow();
  });

  it('缺少新增迁移时明确诊断语言列，不静默丢失选择', async () => {
    const { env, sqlite } = state();
    sqlite.exec('ALTER TABLE jobs DROP COLUMN language_pair');
    expect((await deploymentDiagnostics(env)).database).toMatchObject({ status: 'incomplete', missingColumns: ['jobs.language_pair'] });
    expect((await fetchApi(request('/api/jobs'), env)).status).toBe(503);
  });
});

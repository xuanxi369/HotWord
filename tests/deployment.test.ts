import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deploymentDiagnostics } from '../server/diagnostics';
import { fetchApi } from '../server/http';
import { saveCredential } from '../server/credentials';
import { settings } from '../server/models';
import { createJob } from '../server/jobs';
import { modelDefaults } from '../shared/models';
import { testEnv } from './support/database';

const repair = readFileSync(new URL('../docs/sql/repair-0002-model-tables.sql', import.meta.url), 'utf8');
const request = (path: string) => new Request(`http://localhost${path}`);
const partial = () => {
  const state = testEnv();
  state.sqlite.exec('DROP TABLE admissions; DROP TABLE ai_usage; DROP TABLE connection_probes;');
  return state;
};

describe('网页部署的部分迁移恢复', () => {
  it('业务接口明确报告缺表，管理员诊断在业务表缺失时仍可读取并区分主密钥状态', async () => {
    const { env, sqlite } = partial();
    // An applied migration record must not hide the actual missing schema.
    sqlite.exec("CREATE TABLE d1_migrations(name TEXT); INSERT INTO d1_migrations VALUES('0002_model_credentials.sql');");
    const response = await fetchApi(request('/api/models'), env);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'DATABASE_SCHEMA_INCOMPLETE' });
    const diagnostics = await fetchApi(request('/api/admin/diagnostics'), env);
    expect(diagnostics.status).toBe(200);
    const body = await diagnostics.text();
    expect(JSON.parse(body)).toMatchObject({ database: { status: 'incomplete', missingTables: ['admissions', 'ai_usage', 'connection_probes'] }, encryption: 'ready' });
    expect(body).not.toContain(env.CREDENTIAL_ENCRYPTION_KEY!);
    expect(body).not.toContain(env.DEEPSEEK_API_KEY!);
    expect((await deploymentDiagnostics({ ...env, CREDENTIAL_ENCRYPTION_KEY: '' })).encryption).toBe('missing');
    expect((await deploymentDiagnostics({ ...env, CREDENTIAL_ENCRYPTION_KEY: 'not-a-32-byte-base64-key' })).encryption).toBe('invalid');
  });

  it('补齐 SQL 恢复个人和团队配置，重复执行不改变已有任务、凭据和用量记录', async () => {
    const { env, sqlite } = testEnv();
    const credential = await saveCredential(env, 'local@development', { name: '个人模型', config: modelDefaults('deepseek'), apiKey: 'private-fixture-key', remember: true });
    const job = await createJob(env, 'local@development', { name: '恢复检查', selection: { mode: 'personal', credentialId: credential.id }, segments: [{ id: 'one', label: '原文', text: 'Somnia-梦境公链' }] });
    sqlite.prepare('UPDATE jobs SET status=?,input_tokens=?,output_tokens=?,estimated_usd=? WHERE id=?').run('completed', 30, 40, 0.02, job.id);
    const beforeJobs = sqlite.prepare('SELECT * FROM jobs').all(), beforeCredentials = sqlite.prepare('SELECT * FROM credentials').all();
    sqlite.exec('DROP TABLE admissions; DROP TABLE ai_usage; DROP TABLE connection_probes;');
    sqlite.exec(repair);
    expect((await deploymentDiagnostics(env)).database.status).toBe('ready');
    expect((await settings(env, 'local@development'))).toMatchObject({ personalReady: true, credentials: [{ id: credential.id }] });
    expect((await fetchApi(request('/api/admin/models'), env)).status).toBe(200);
    expect(sqlite.prepare('SELECT * FROM admissions').get()).toMatchObject({ id: job.id, mode: 'personal', credential_id: credential.id, active: 0, input_tokens: 30, output_tokens: 40, estimated_usd: 0.02 });
    sqlite.prepare('UPDATE admissions SET input_tokens=?,reserved_output=? WHERE id=?').run(50, 99, job.id);
    sqlite.exec("INSERT INTO connection_probes VALUES('probe','local@development',1);");
    const beforeAdmissions = sqlite.prepare('SELECT * FROM admissions').all();
    sqlite.exec(repair);
    expect(sqlite.prepare('SELECT * FROM admissions').all()).toEqual(beforeAdmissions);
    expect(sqlite.prepare('SELECT * FROM jobs').all()).toEqual(beforeJobs);
    expect(sqlite.prepare('SELECT * FROM credentials').all()).toEqual(beforeCredentials);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM connection_probes').get()?.n).toBe(1);
  });

  it('诊断能识别部分缺列以及丢失或不可用的数据库绑定，不暴露原始异常', async () => {
    const { env, sqlite } = testEnv();
    sqlite.exec('ALTER TABLE jobs DROP COLUMN service_name;');
    expect((await deploymentDiagnostics(env)).database).toMatchObject({ status: 'incomplete', missingColumns: ['jobs.service_name'] });
    expect((await fetchApi(request('/api/jobs'), env)).status).toBe(503);
    expect((await deploymentDiagnostics({ ...env, DB: undefined! })).database.status).toBe('missing_binding');
    const broken = { ...env, DB: { prepare() { throw new Error('internal-private-details'); } } as unknown as typeof env.DB };
    const status = await deploymentDiagnostics(broken);
    expect(status.database.status).toBe('unavailable');
    expect(JSON.stringify(status)).not.toContain('internal-private-details');
  });
});

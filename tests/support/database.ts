import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import type { Env } from '../../server/env';

export function testEnv() {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of ['0001_jobs.sql', '0002_model_credentials.sql']) sqlite.exec(readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'));
  function prepare(sql: string) {
    let args: any[] = [];
    const statement = {
      bind(...values: any[]) { args = values; return statement; },
      async first<T>() { return (sqlite.prepare(sql).get(...args) ?? null) as T | null; },
      async all<T>() { return { results: sqlite.prepare(sql).all(...args) as T[], success: true }; },
      async run() { const result = sqlite.prepare(sql).run(...args); return { success: true, meta: { changes: Number(result.changes) } }; },
    };
    return statement;
  }
  const objects = new Map<string, string>(), starts: string[] = [], terminated: string[] = [];
  let batchQueue = Promise.resolve();
  const env = {
    AUTH_MODE: 'local', ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '', AI_MODEL: '@cf/qwen/qwen3.8-27b',
    CREDENTIAL_ENCRYPTION_KEY: btoa('0123456789abcdef0123456789abcdef'), OPENAI_API_KEY: 'team-test-key', DEEPSEEK_API_KEY: 'team-deepseek-key',
    DB: { prepare, batch(statements: ReturnType<typeof prepare>[]) {
      const result = batchQueue.then(async () => {
        sqlite.exec('BEGIN'); try { const values = []; for (const s of statements) values.push(await s.run()); sqlite.exec('COMMIT'); return values; } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
      });
      batchQueue = result.then(() => {}, () => {}); return result;
    } },
    FILES: {
      async put(key: string, value: string) { objects.set(key, value); },
      async get(key: string) { const value = objects.get(key); return value === undefined ? null : { body: value, json: async () => JSON.parse(value) }; },
      async head(key: string) { return objects.has(key) ? {} : null; },
      async list({ prefix }: { prefix: string }) { return { objects: [...objects.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })), truncated: false }; },
      async delete(keys: string | string[]) { for (const k of typeof keys === 'string' ? [keys] : keys) objects.delete(k); },
    },
    EXTRACT: { async create({ id }: { id: string }) { starts.push(id); }, async get(id: string) { return { async terminate() { terminated.push(id); } }; } },
  } as unknown as Env;
  return { env, sqlite, objects, starts, terminated };
}

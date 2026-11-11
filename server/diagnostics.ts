import type { DeploymentDiagnostics } from '../shared/models';
import { encryptionReady } from './credentials';
import type { Env } from './env';
import { secretNames } from './providers';

const requiredColumns: Record<string, string[]> = {
  jobs: ['id', 'owner', 'name', 'status', 'progress', 'total', 'error', 'created_at', 'expires_at', 'mode', 'provider', 'model', 'service_name', 'model_config', 'service_id', 'credential_id', 'input_tokens', 'output_tokens', 'estimated_usd', 'usage_estimated', 'language_pair'],
  credentials: ['id', 'owner', 'name', 'masked_key', 'config', 'ciphertext', 'nonce', 'remember', 'created_at', 'expires_at'],
  job_secrets: ['job_id', 'owner', 'ciphertext', 'nonce', 'expires_at'],
  team_services: ['id', 'config'], member_policies: ['email', 'config'],
  admissions: ['id', 'owner', 'mode', 'credential_id', 'created_at', 'active', 'reserved_input', 'reserved_output', 'reserved_usd', 'input_tokens', 'output_tokens', 'estimated_usd'],
  ai_usage: ['id', 'job_id', 'owner', 'mode', 'provider', 'model', 'input_tokens', 'output_tokens', 'estimated_usd', 'estimated', 'created_at'],
  connection_probes: ['id', 'owner', 'created_at'],
};

// Only schema metadata and readiness flags are returned, never secret values or user records.
export async function deploymentDiagnostics(env: Env): Promise<DeploymentDiagnostics> {
  const database: DeploymentDiagnostics['database'] = { status: 'missing_binding', missingTables: [], missingColumns: [] };
  if (env.DB) {
    try {
      const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all<{ name: string }>();
      const names = new Set(tables.results.map(t => t.name));
      database.missingTables = Object.keys(requiredColumns).filter(name => !names.has(name));
      const columns = await Promise.all(Object.keys(requiredColumns).filter(name => names.has(name)).map(async name => {
        const rows = await env.DB.prepare(`PRAGMA table_info(${name})`).all<{ name: string }>();
        const present = new Set(rows.results.map(c => c.name));
        return requiredColumns[name].filter(c => !present.has(c)).map(c => `${name}.${c}`);
      }));
      database.missingColumns = columns.flat();
      database.status = database.missingTables.length || database.missingColumns.length ? 'incomplete' : 'ready';
    } catch { database.status = 'unavailable'; }
  }
  return {
    database,
    encryption: !env.CREDENTIAL_ENCRYPTION_KEY?.trim() ? 'missing' : await encryptionReady(env) ? 'ready' : 'invalid',
    bindings: { DB: !!env.DB, FILES: !!env.FILES, EXTRACT: !!env.EXTRACT, AI: !!env.AI, ASSETS: !!env.ASSETS },
    teamKeys: Object.fromEntries(Object.entries(secretNames).map(([provider, name]) => [provider, typeof env[name!] === 'string' && !!(env[name!] as string).trim()])),
  };
}

export function isDatabaseSchemaError(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 3 && current instanceof Error; depth++) {
    if (/no such (?:table|column)\s*:|has no column named/i.test(current.message)) return true;
    current = current.cause;
  }
  return false;
}

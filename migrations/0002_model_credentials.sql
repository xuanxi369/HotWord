ALTER TABLE jobs ADD COLUMN mode TEXT NOT NULL DEFAULT 'team';
ALTER TABLE jobs ADD COLUMN provider TEXT NOT NULL DEFAULT 'cloudflare';
ALTER TABLE jobs ADD COLUMN model TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN service_name TEXT NOT NULL DEFAULT 'Workers AI';
ALTER TABLE jobs ADD COLUMN model_config TEXT;
ALTER TABLE jobs ADD COLUMN service_id TEXT;
ALTER TABLE jobs ADD COLUMN credential_id TEXT;
ALTER TABLE jobs ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN estimated_usd REAL;
ALTER TABLE jobs ADD COLUMN usage_estimated INTEGER NOT NULL DEFAULT 0;
CREATE TABLE credentials (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, masked_key TEXT NOT NULL,
  config TEXT NOT NULL, ciphertext TEXT NOT NULL, nonce TEXT NOT NULL,
  remember INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, expires_at INTEGER
);
CREATE INDEX credentials_owner ON credentials(owner);
CREATE INDEX credentials_expiry ON credentials(expires_at);
CREATE TABLE job_secrets (
  job_id TEXT PRIMARY KEY, owner TEXT NOT NULL, ciphertext TEXT NOT NULL, nonce TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX job_secrets_expiry ON job_secrets(expires_at);
CREATE TABLE team_services (id TEXT PRIMARY KEY, config TEXT NOT NULL);
CREATE TABLE member_policies (email TEXT PRIMARY KEY, config TEXT NOT NULL);
-- Admissions and usage survive task deletion, so deleting tasks cannot reset quotas.
CREATE TABLE admissions (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, mode TEXT NOT NULL, credential_id TEXT, created_at INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  reserved_input INTEGER NOT NULL DEFAULT 0, reserved_output INTEGER NOT NULL DEFAULT 0, reserved_usd REAL NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, estimated_usd REAL NOT NULL DEFAULT 0
);
INSERT INTO admissions(id,owner,mode,created_at,active)
  SELECT id,owner,'team',created_at,CASE WHEN status IN ('queued','running') THEN 1 ELSE 0 END FROM jobs;
CREATE INDEX admissions_owner_time ON admissions(owner,created_at);
CREATE INDEX admissions_time ON admissions(created_at);
CREATE TABLE ai_usage (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL, owner TEXT NOT NULL, mode TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, estimated_usd REAL, estimated INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX ai_usage_owner_time ON ai_usage(owner,created_at);
CREATE TABLE connection_probes (id TEXT PRIMARY KEY, owner TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX probes_owner_time ON connection_probes(owner,created_at);

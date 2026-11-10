CREATE TABLE IF NOT EXISTS admissions (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, mode TEXT NOT NULL, credential_id TEXT, created_at INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  reserved_input INTEGER NOT NULL DEFAULT 0, reserved_output INTEGER NOT NULL DEFAULT 0, reserved_usd REAL NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, estimated_usd REAL NOT NULL DEFAULT 0
);
INSERT INTO admissions(id,owner,mode,credential_id,created_at,active,input_tokens,output_tokens,estimated_usd)
  SELECT j.id,j.owner,j.mode,j.credential_id,j.created_at,CASE WHEN j.status IN ('queued','running') THEN 1 ELSE 0 END,j.input_tokens,j.output_tokens,COALESCE(j.estimated_usd,0)
  FROM jobs j WHERE NOT EXISTS (SELECT 1 FROM admissions a WHERE a.id=j.id);
CREATE INDEX IF NOT EXISTS admissions_owner_time ON admissions(owner,created_at);
CREATE INDEX IF NOT EXISTS admissions_time ON admissions(created_at);
CREATE TABLE IF NOT EXISTS ai_usage (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL, owner TEXT NOT NULL, mode TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, estimated_usd REAL, estimated INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_usage_owner_time ON ai_usage(owner,created_at);
CREATE TABLE IF NOT EXISTS connection_probes (id TEXT PRIMARY KEY, owner TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS probes_owner_time ON connection_probes(owner,created_at);

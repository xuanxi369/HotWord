export type Env = {
  ASSETS: Fetcher; DB: D1Database; FILES: R2Bucket; AI: Ai;
  EXTRACT: Workflow<{ id: string }>;
  AUTH_MODE: string; ACCESS_TEAM_DOMAIN: string; ACCESS_AUD: string; AI_MODEL: string;
  ADMIN_EMAILS?: string; TEAM_SERVICES?: string; CREDENTIAL_ENCRYPTION_KEY?: string;
  OPENAI_API_KEY?: string; ANTHROPIC_API_KEY?: string; DEEPSEEK_API_KEY?: string; ZHIPU_API_KEY?: string; QWEN_API_KEY?: string;
};

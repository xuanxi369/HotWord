export type Env = {
  ASSETS: Fetcher; DB: D1Database; FILES: R2Bucket; AI: Ai;
  EXTRACT: Workflow<{ id: string }>;
  AUTH_MODE: string; ACCESS_TEAM_DOMAIN: string; ACCESS_AUD: string; AI_MODEL: string;
};

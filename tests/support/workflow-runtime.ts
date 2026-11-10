import type { Env } from '../../server/env';
export class WorkflowEntrypoint { constructor(_ctx: unknown, public env: Env) {} }
export class NonRetryableError extends Error {}

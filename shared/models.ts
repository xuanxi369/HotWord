import { z } from 'zod';

export const Provider = z.enum(['openai', 'claude', 'deepseek', 'zhipu', 'qwen', 'cloudflare']);
export type Provider = z.infer<typeof Provider>;
export const providerNames: Record<Provider, string> = {
  openai: 'OpenAI / ChatGPT', claude: 'Claude', deepseek: 'DeepSeek', zhipu: '智谱 GLM', qwen: '千问 Qwen', cloudflare: 'Cloudflare Workers AI',
};
export const qwenRegions = {
  'cn-beijing': '中国北京', 'ap-southeast-1': '新加坡', 'us-east-1': '美国弗吉尼亚',
  'eu-central-1': '德国法兰克福', 'ap-northeast-1': '日本东京', 'cn-hongkong': '中国香港',
};
export const ModelConfigSchema = z.object({
  provider: Provider,
  model: z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9@/_.:-]+$/),
  region: z.enum(['cn-beijing', 'ap-southeast-1', 'us-east-1', 'eu-central-1', 'ap-northeast-1', 'cn-hongkong']).default('cn-beijing'),
  workspace: z.string().trim().max(80).regex(/^$|^[a-zA-Z0-9][a-zA-Z0-9_-]*$/).default(''),
  outputMode: z.enum(['json_schema', 'json_object', 'prompt']).default('prompt'),
  maxOutputTokens: z.number().int().min(256).max(16000).default(4096),
  contextWindow: z.number().int().min(8192).max(2000000).default(32768),
  thinking: z.enum(['default', 'disabled', 'enabled']).default('default'),
}).strict().superRefine((v, ctx) => {
  if (v.maxOutputTokens + 2048 >= v.contextWindow) ctx.addIssue({ code: 'custom', message: '上下文长度须大于输出上限加 2048' });
  if (v.provider === 'qwen' && !v.workspace && !['cn-beijing', 'ap-southeast-1', 'us-east-1'].includes(v.region)) ctx.addIssue({ code: 'custom', message: '此千问区域必须填写业务空间 ID' });
  if (v.provider === 'qwen' && v.workspace && !/^[a-z0-9][a-z0-9-]{0,62}$/.test(v.workspace)) ctx.addIssue({ code: 'custom', message: '千问业务空间 ID 必须是有效的域名标签' });
  if (v.provider === 'claude' && v.workspace && !/^wrkspc_[a-zA-Z0-9]+$/.test(v.workspace)) ctx.addIssue({ code: 'custom', message: 'Claude 工作空间 ID 应以 wrkspc_ 开头' });
  if (['deepseek', 'zhipu', 'claude'].includes(v.provider) && v.outputMode === 'json_schema') ctx.addIssue({ code: 'custom', message: '此适配器支持 JSON 模式或提示词 JSON，请选择对应能力' });
  if (v.provider === 'claude' && v.outputMode !== 'prompt') ctx.addIssue({ code: 'custom', message: 'Claude 适配器使用原生 Messages 与提示词 JSON' });
  if (!['deepseek', 'zhipu', 'qwen'].includes(v.provider) && v.thinking !== 'default') ctx.addIssue({ code: 'custom', message: '此适配器不接受思考模式开关' });
});
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
type Recommendation = { model: string; outputMode: ModelConfig['outputMode']; maxOutputTokens: number; contextWindow: number; thinking?: ModelConfig['thinking'] };
export const recommendedModels: Record<Provider, Recommendation[]> = {
  openai: [{ model: 'gpt-4.1-mini', outputMode: 'json_schema', maxOutputTokens: 8000, contextWindow: 128000 }],
  claude: [{ model: 'claude-sonnet-4-6', outputMode: 'prompt', maxOutputTokens: 8000, contextWindow: 200000 }],
  deepseek: [{ model: 'deepseek-flash', outputMode: 'json_object', maxOutputTokens: 8000, contextWindow: 128000, thinking: 'disabled' }, { model: 'deepseek-v4-pro', outputMode: 'json_object', maxOutputTokens: 8000, contextWindow: 128000, thinking: 'disabled' }],
  zhipu: [{ model: 'glm-5.3', outputMode: 'json_object', maxOutputTokens: 8000, contextWindow: 128000, thinking: 'disabled' }],
  qwen: [{ model: 'qwen-plus', outputMode: 'json_object', maxOutputTokens: 8000, contextWindow: 128000, thinking: 'disabled' }],
  cloudflare: [{ model: '@cf/qwen/qwen3.8-27b', outputMode: 'json_schema', maxOutputTokens: 12000, contextWindow: 32768 }],
};
export function modelDefaults(provider: Provider, model = recommendedModels[provider][0].model): ModelConfig {
  return ModelConfigSchema.parse({ provider, model, ...recommendedModels[provider].find(m => m.model === model) });
}
// URLs are constructed from official presets only. Keys cannot be routed to arbitrary hosts.
export function endpoint(config: ModelConfig): string {
  switch (config.provider) {
    case 'openai': return 'https://api.openai.com/v1/responses';
    case 'claude': return 'https://api.anthropic.com/v1/messages';
    case 'deepseek': return 'https://api.deepseek.com/chat/completions';
    case 'zhipu': return 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
    case 'qwen': {
      const host = config.workspace ? `${config.workspace}.${config.region}.maas.aliyuncs.com` :
        ({ 'cn-beijing': 'dashscope.aliyuncs.com', 'ap-southeast-1': 'dashscope-intl.aliyuncs.com', 'us-east-1': 'dashscope-us.aliyuncs.com' } as Record<string, string>)[config.region];
      if (!host) throw new Error('千问此区域需要业务空间 ID');
      return `https://${host}/compatible-mode/v1/chat/completions`;
    }
    case 'cloudflare': return 'Cloudflare AI binding';
  }
}
export const TeamServiceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,60}$/), name: z.string().trim().min(1).max(80), enabled: z.boolean().default(true),
  config: ModelConfigSchema,
  inputUsdPerMillion: z.number().min(0).max(10000).nullable().default(null),
  outputUsdPerMillion: z.number().min(0).max(10000).nullable().default(null),
}).strict();
export type TeamService = z.infer<typeof TeamServiceSchema>;
export type PublicService = TeamService & { ready: boolean };
export const MemberPolicySchema = z.object({
  email: z.union([z.email().max(200), z.literal('local@development')]).transform(s => s.toLowerCase()),
  teamDailyTasks: z.number().int().min(0).max(200).default(20),
  teamDailyInput: z.number().int().min(0).max(100000000).default(2000000),
  teamDailyOutput: z.number().int().min(0).max(100000000).default(1000000),
  teamDailyUsd: z.number().min(0).max(100000).nullable().default(null),
}).strict();
export type MemberPolicy = z.infer<typeof MemberPolicySchema>;
export const ModelSelectionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('team'), serviceId: z.string().regex(/^[a-z0-9-]{1,60}$/) }).strict(),
  z.object({ mode: z.literal('personal'), credentialId: z.uuid() }).strict(),
]);
export type ModelSelection = z.infer<typeof ModelSelectionSchema>;
export type Credential = { id: string; name: string; masked_key: string; config: ModelConfig; remember: boolean; created_at: number; expires_at: number | null };
export type UsageSummary = { mode: 'team' | 'personal'; tasks: number; input_tokens: number; output_tokens: number; estimated_usd: number | null; estimated_calls: number; unpriced_calls: number };
export type ModelSettings = { services: PublicService[]; credentials: Credential[]; policy: MemberPolicy; usage: UsageSummary[]; personalReady: boolean; platformDailyTasks: number; platformConcurrency: number;
  available: { teamTasks: number; teamInput: number; teamOutput: number; teamUsd: number | null; platformTasks: number; concurrency: number } };

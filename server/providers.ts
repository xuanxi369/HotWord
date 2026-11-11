import { endpoint, type ModelConfig, type Provider } from '../shared/models';
import { HttpError } from './auth';
import type { Env } from './env';

export type TokenUsage = { input: number; output: number; estimated: boolean };
export class ModelError extends HttpError {
  constructor(message: string, public retryable = false, public usage?: TokenUsage, status = 502) { super(status, message); }
}
export class OutputLimitError extends ModelError {
  constructor(message: string, usage: TokenUsage) { super(message, false, usage); }
}
export const secretNames: Partial<Record<Provider, keyof Env>> = { openai: 'OPENAI_API_KEY', claude: 'ANTHROPIC_API_KEY', deepseek: 'DEEPSEEK_API_KEY', zhipu: 'ZHIPU_API_KEY', qwen: 'QWEN_API_KEY' };
export function teamKey(env: Env, provider: Provider): string {
  if (provider === 'cloudflare') return '';
  const name = secretNames[provider], key = name && env[name];
  if (typeof key !== 'string' || !key.trim()) throw new HttpError(503, '所选团队服务尚未配置 API Key，请选择其他已开放服务');
  return key.trim();
}
function usageOf(raw: any, fallback: TokenUsage): TokenUsage {
  const u = raw?.usage, input = u?.input_tokens ?? u?.prompt_tokens, output = u?.output_tokens ?? u?.completion_tokens;
  if (!Number.isSafeInteger(input) || input < 0 || !Number.isSafeInteger(output) || output < 0) return fallback;
  const cache = [u?.cache_creation_input_tokens, u?.cache_read_input_tokens].reduce((n: number, v: unknown) => n + (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : 0), 0);
  return { input: input + cache, output, estimated: false };
}
export function buildRequest(c: ModelConfig, system: string, text: string, schema?: object, probe = false) {
  const cap = probe ? 128 : c.maxOutputTokens;
  if (c.provider === 'openai') return { model: c.model, instructions: system, input: text, max_output_tokens: cap, store: false,
    ...(!probe && c.outputMode !== 'prompt' ? { text: { format: c.outputMode === 'json_schema' ? { type: 'json_schema', name: 'conference_terms', strict: true, schema } : { type: 'json_object' } } } : {}) };
  if (c.provider === 'claude') return { model: c.model, system, messages: [{ role: 'user', content: text }], max_tokens: cap, stream: false };
  const body: Record<string, unknown> = { model: c.model, messages: [{ role: 'system', content: system }, { role: 'user', content: text }], max_tokens: cap, stream: false };
  if (!probe && c.outputMode !== 'prompt') body.response_format = c.outputMode === 'json_schema'
    ? { type: 'json_schema', json_schema: { name: 'conference_terms', strict: true, schema } } : { type: 'json_object' };
  if (c.thinking !== 'default') {
    if (c.provider === 'qwen') body.enable_thinking = c.thinking === 'enabled';
    if (['deepseek', 'zhipu'].includes(c.provider)) body.thinking = { type: c.thinking };
  }
  return body;
}
export function decodeReply(c: ModelConfig, raw: any, fallback: TokenUsage): { value: unknown; usage: TokenUsage } {
  const usage = usageOf(raw, fallback);
  const fail = (message: string): never => { throw new ModelError(message, false, usage); };
  const outputLimit = (message: string): never => { throw new OutputLimitError(message, usage); };
  if (c.provider === 'openai') {
    if (raw?.status === 'incomplete' && raw?.incomplete_details?.reason === 'max_output_tokens') outputLimit('模型输出达到上限，请提高输出上限或减少所选内容');
    if (raw?.status === 'incomplete') fail('模型输出未完成或达到输出上限，请提高输出上限或减少所选内容');
    if (raw?.status !== 'completed') fail('OpenAI 未返回完整结果，请检查模型配置后重试');
    const content = (raw.output ?? []).filter((o: any) => o.type === 'message').flatMap((o: any) => o.content ?? []);
    if (content.some((o: any) => o.type === 'refusal')) fail('模型拒绝处理所选内容，请检查资料');
    const value = content.filter((o: any) => o.type === 'output_text').map((o: any) => o.text ?? '').join('');
    if (!value.trim()) fail('模型返回空内容，请检查模型或重试');
    return { value, usage };
  }
  if (c.provider === 'claude') {
    if (raw?.stop_reason === 'max_tokens') outputLimit('Claude 输出被截断，请提高输出上限或减少所选内容');
    if (raw?.stop_reason === 'refusal') fail('Claude 拒绝处理所选内容，请检查资料');
    if (!['end_turn', 'stop_sequence'].includes(raw?.stop_reason)) fail('Claude 未返回完整文本，请检查模型能力');
    const value = (raw.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text ?? '').join('');
    if (!value.trim()) fail('Claude 返回空内容，请检查配置或重试');
    return { value, usage };
  }
  const choice = raw?.choices?.[0];
  if (choice?.finish_reason === 'length') outputLimit('模型输出被截断，请提高输出上限或减少所选内容');
  if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal) fail('模型拒绝处理所选内容，请检查资料');
  if (choice && choice.finish_reason !== 'stop') fail('模型未返回完整文本，请检查配置');
  const value = raw?.response ?? choice?.message?.content ?? (c.provider === 'cloudflare' ? raw : undefined);
  if (value == null || (typeof value === 'string' && !value.trim())) fail('模型返回空内容，请检查配置或重试');
  return { value, usage };
}
async function responseJson(response: Response) {
  if (!response.body) throw new Error();
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length; if (size > 2000000) { await reader.cancel(); throw new Error(); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function invokeModel(env: Env, c: ModelConfig, key: string, system: string, text: string, schema?: object, probe = false) {
  const fallback: TokenUsage = { input: system.length + text.length + 256, output: probe ? 128 : c.maxOutputTokens, estimated: true };
  let raw: unknown;
  if (c.provider === 'cloudflare') {
    try {
      const run = env.AI.run.bind(env.AI) as unknown as (model: string, input: Record<string, unknown>) => Promise<unknown>;
      raw = await run(c.model, { messages: [{ role: 'system', content: system }, { role: 'user', content: text }],
        ...(!probe && c.outputMode !== 'prompt' ? { response_format: { type: c.outputMode, ...(c.outputMode === 'json_schema' ? { json_schema: schema } : {}) } } : {}),
        max_completion_tokens: probe ? 128 : c.maxOutputTokens, reasoning_effort: 'low', stream: false, store: false });
    } catch { throw new ModelError('Cloudflare 模型调用失败，请检查账号额度和模型配置', true, fallback); }
  } else {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (c.provider === 'claude') { headers['x-api-key'] = key; headers['anthropic-version'] = '2023-06-01'; if (c.workspace) headers['anthropic-workspace-id'] = c.workspace; }
    else headers.Authorization = `Bearer ${key}`;
    let response: Response;
    // Workers supports only follow/manual. Inspect redirects explicitly instead
    // of using Node's "error" mode, which throws before the request is sent.
    try { response = await fetch(endpoint(c), { method: 'POST', headers, body: JSON.stringify(buildRequest(c, system, text, schema, probe)), redirect: 'manual', signal: AbortSignal.timeout(120000) }); }
    catch { throw new ModelError('模型连接超时或网络异常，请重试。未切换使用模式或密钥。', true, fallback); }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new ModelError('服务商接口返回重定向，已停止请求，请检查服务商接口配置', false, { input: 0, output: 0, estimated: false });
    }
    if (!response.ok) {
      await response.body?.cancel();
      const messages: Record<number, string> = { 400: '模型参数或工作空间不匹配，请检查模型能力、区域和工作空间', 401: 'API Key 无效或已过期，请重新配置',
        403: 'API Key 没有所选模型或工作空间的权限', 404: '模型或工作空间不存在，请检查模型 ID、区域和工作空间',
        402: '服务商账户余额不足，请充值或手动选择其他服务', 429: '服务商额度不足或请求过于频繁，请稍后重试' };
      throw new ModelError(messages[response.status] ?? '服务商暂时不可用，请稍后重试', response.status === 429 || response.status >= 500,
        response.status >= 500 ? fallback : { input: 0, output: 0, estimated: false });
    }
    try { raw = await responseJson(response); }
    catch { throw new ModelError('服务商响应格式无效或过大，未生成完整结果', false, fallback); }
  }
  try { return decodeReply(c, raw, fallback); }
  catch (e) { if (e instanceof ModelError) throw e; throw new ModelError('服务商响应结构无效，未生成完整结果', false, usageOf(raw, fallback)); }
}
export function parseModelJson(value: unknown, usage: TokenUsage): unknown {
  if (typeof value !== 'string') return value;
  const text = value.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1');
  try { return JSON.parse(text); }
  catch { throw new ModelError('模型输出不是完整 JSON，请调整模型能力或重试', false, usage); }
}

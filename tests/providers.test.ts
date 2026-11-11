import { afterEach, describe, expect, it, vi } from 'vitest';
import { endpoint, ModelConfigSchema, modelDefaults, type Provider } from '../shared/models';
import { extractChunk, promptTokenReserve, termLimit } from '../server/ai';
import { buildRequest, invokeModel, parseModelJson } from '../server/providers';
import type { Env } from '../server/env';

export const text = 'Somnia-梦境公链，Industrial Collaboration-产业协同';
export const terms = { terms: [{ source: 'Somnia', target: '梦境公链', category: 'company', priority: 90, basis: 'source', evidence: text }, { source: 'Industrial Collaboration', target: '产业协同', category: 'industry', priority: 80, basis: 'source', evidence: text }] };
export function reply(provider: Provider, content = JSON.stringify(terms)) {
  if (provider === 'openai') return { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: content }] }], usage: { input_tokens: 100, output_tokens: 80 } };
  if (provider === 'claude') return { stop_reason: 'end_turn', content: [{ type: 'text', text: content }], usage: { input_tokens: 100, output_tokens: 80 } };
  return { choices: [{ finish_reason: 'stop', message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 80 } };
}
afterEach(() => vi.unstubAllGlobals());
describe('五家服务原生协议与共同提取规则', () => {
  for (const provider of ['openai', 'claude', 'deepseek', 'zhipu', 'qwen'] as const) it(`${provider} 从协议响应进入依据校验与人工审核`, async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(reply(provider))); vi.stubGlobal('fetch', fetcher);
    const record = vi.fn(), config = modelDefaults(provider);
    const result = await extractChunk({} as Env, config, 'personal-test-key', text, '测试资料', 't', record);
    expect(result.candidates.map(c => c.target)).toEqual(['梦境公链', '产业协同']);
    expect(record).toHaveBeenCalledWith({ input: 100, output: 80, estimated: false });
    const [url, init] = fetcher.mock.calls[0]; expect(url).toBe(endpoint(config)); expect(init.redirect).toBe('manual');
    const body = JSON.parse(init.body); expect(body.model).toBe(config.model);
    if (provider === 'openai') { expect(body.text.format.type).toBe('json_schema'); expect(body.store).toBe(false); expect(body).not.toHaveProperty('messages'); }
    else if (provider === 'claude') { expect(init.headers['x-api-key']).toBe('personal-test-key'); expect(init.headers['anthropic-version']).toBe('2023-06-01'); expect(body.system).toContain('原文'); }
    else { expect(init.headers.Authorization).toBe('Bearer personal-test-key'); expect(body.response_format.type).toBe('json_object'); }
  });
  it('Claude 工作空间随请求发送；千问区域与业务空间固定在官方域名', async () => {
    const c = ModelConfigSchema.parse({ ...modelDefaults('qwen'), region: 'cn-hongkong', workspace: 'llm-example' });
    expect(endpoint(c)).toBe('https://llm-example.cn-hongkong.maas.aliyuncs.com/compatible-mode/v1/chat/completions');
    expect(() => ModelConfigSchema.parse({ ...c, workspace: 'evil.com/x' })).toThrow();
    expect(() => ModelConfigSchema.parse({ ...c, workspace: '' })).toThrow();
    expect(() => ModelConfigSchema.parse({ ...c, baseUrl: 'https://evil.example' })).toThrow();
    const fetcher = vi.fn().mockResolvedValue(Response.json(reply('claude'))); vi.stubGlobal('fetch', fetcher);
    await invokeModel({} as Env, { ...modelDefaults('claude'), workspace: 'wrkspc_123' }, 'test-key', 'system', 'input');
    expect(fetcher.mock.calls[0][1].headers['anthropic-workspace-id']).toBe('wrkspc_123');
  });
  it('手动模型不假定结构化输出与思考参数兼容', () => {
    const c = modelDefaults('openai', 'custom-model'); expect(c.outputMode).toBe('prompt');
    expect(buildRequest(c, 's', 't')).not.toHaveProperty('text');
    expect(() => ModelConfigSchema.parse({ ...modelDefaults('claude'), outputMode: 'json_schema' })).toThrow();
    expect(buildRequest(modelDefaults('qwen'), 's', 't')).toHaveProperty('enable_thinking', false);
    expect(buildRequest(modelDefaults('deepseek'), 's', 't')).toHaveProperty('thinking', { type: 'disabled' });
  });
  it('提取提示词按实际输出上限限制条数、要求最短证据和紧凑 JSON', async () => {
    const config = { ...modelDefaults('deepseek'), maxOutputTokens: 2048 };
    const fetcher = vi.fn().mockResolvedValue(Response.json(reply('deepseek'))); vi.stubGlobal('fetch', fetcher);
    await extractChunk({} as Env, config, 'synthetic-key', text, '原文', 't', vi.fn());
    const body = JSON.parse(fetcher.mock.calls[0][1].body), system = body.messages[0].content as string;
    expect(body.max_tokens).toBe(2048);
    expect(system).toContain(`最多 ${termLimit(config)} 条词条`);
    expect(system).toContain('最短摘录'); expect(system).toContain('紧凑 JSON');
    expect(system.length + 256).toBeLessThanOrEqual(promptTokenReserve);
  });
  it('401 错误不泄露服务商响应或密钥，不换密钥，不重试', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('secret-test-key sensitive provider detail', { status: 401 })); vi.stubGlobal('fetch', fetcher);
    const record = vi.fn();
    await expect(extractChunk({} as Env, modelDefaults('openai'), 'secret-test-key', text, 'x', 'x', record)).rejects.toMatchObject({ retryable: false, message: 'API Key 无效或已过期，请重新配置' });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(record).toHaveBeenCalledWith({ input: 0, output: 0, estimated: false });
  });
  it('拒绝服务商重定向，不发送第二次请求或暴露响应内容', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('private-provider-detail', { status: 307, headers: { Location: 'https://other.example/' } }));
    vi.stubGlobal('fetch', fetcher); const record = vi.fn();
    await expect(extractChunk({} as Env, modelDefaults('deepseek'), 'secret-test-key', text, 'x', 'x', record)).rejects.toMatchObject({
      retryable: false, message: '服务商接口返回重定向，已停止请求，请检查服务商接口配置',
    });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(record).toHaveBeenCalledWith({ input: 0, output: 0, estimated: false });
  });
  it('不完整、拒绝、失效 JSON 都拒绝且保留已消耗用量', async () => {
    for (const payload of [{ ...reply('openai'), status: 'incomplete' }, reply('openai', 'not-json'), { ...reply('openai'), output: [{ type: 'message', content: [{ type: 'refusal' }] }] }]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(payload))); const record = vi.fn();
      await expect(extractChunk({} as Env, modelDefaults('openai'), 'test-key', text, 'x', 'x', record)).rejects.toThrow();
      expect(record).toHaveBeenCalledWith({ input: 100, output: 80, estimated: false });
    }
    expect(parseModelJson('```json\n{"terms":[]}\n```', { input: 0, output: 0, estimated: false })).toEqual({ terms: [] });
  });
  it('空白 JSON 和截断 Chat 响应不会当成成功', async () => {
    for (const payload of [reply('deepseek', '   '), { ...reply('deepseek'), choices: [{ finish_reason: 'length', message: { content: '{"terms":[]}' } }] }]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(payload)));
      await expect(invokeModel({} as Env, modelDefaults('deepseek'), 'test-key', 's', 't')).rejects.toThrow();
    }
  });
});

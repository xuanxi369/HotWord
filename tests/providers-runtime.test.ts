import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { fileURLToPath } from 'node:url';

// Exercise the actual adapter in workerd. Node's mocked fetch accepts redirect
// modes that Cloudflare rejects before any request reaches the provider.
let runtime: Miniflare;
beforeAll(async () => {
  const bundle = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL('..', import.meta.url)),
      contents: `
        import { invokeModel } from './server/providers';
        import { modelDefaults } from './shared/models';
        export default { async fetch(request) {
          const url = new URL(request.url);
          try {
            const result = await invokeModel({}, modelDefaults(url.searchParams.get('provider')), 'synthetic-key', url.searchParams.get('scenario') || 'success', 'synthetic text');
            return Response.json({ ok: true, ...result });
          } catch (error) {
            return Response.json({ ok: false, message: error.message, retryable: error.retryable, usage: error.usage });
          }
        } };
      `,
    },
    bundle: true, format: 'esm', target: 'es2022', write: false,
  });
  runtime = new Miniflare(convertV4MiniflareOptions({ workers: [
    { name: 'adapter', modules: true, compatibilityDate: '2026-11-10', script: bundle.outputFiles[0].text, outboundService: 'synthetic-provider' },
    { name: 'synthetic-provider', modules: true, compatibilityDate: '2026-11-10', script: `
      export default { async fetch(request) {
        const body = await request.json(), host = new URL(request.url).hostname;
        const scenario = body.instructions || body.system || body.messages?.[0]?.content;
        if (scenario === 'redirect' && host !== 'other.example') {
          return new Response('private-provider-detail', { status: 307, headers: { Location: 'https://other.example/' } });
        }
        const text = '{"terms":[]}', usage = { prompt_tokens: 10, completion_tokens: 5, input_tokens: 10, output_tokens: 5 };
        if (host === 'api.openai.com') return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }], usage });
        if (host === 'api.anthropic.com') return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text }], usage });
        return Response.json({ choices: [{ finish_reason: 'stop', message: { content: text } }], usage });
      } };
    ` },
  ] }));
}, 20000);
afterAll(async () => { await runtime?.dispose(); });

describe('Cloudflare 真实运行时的外部服务请求', () => {
  for (const provider of ['openai', 'claude', 'deepseek', 'zhipu', 'qwen']) it(`${provider} 请求能通过 Workers 参数校验并读回响应`, async () => {
    const result = await (await runtime.dispatchFetch(`http://localhost/?provider=${provider}`)).json();
    expect(result).toEqual({ ok: true, value: '{"terms":[]}', usage: { input: 10, output: 5, estimated: false } });
  });
  it('重定向被明确拒绝且不跟随到其他域名', async () => {
    const result = await (await runtime.dispatchFetch('http://localhost/?provider=deepseek&scenario=redirect')).json();
    expect(result).toEqual({ ok: false, message: '服务商接口返回重定向，已停止请求，请检查服务商接口配置', retryable: false, usage: { input: 0, output: 0, estimated: false } });
  });
});

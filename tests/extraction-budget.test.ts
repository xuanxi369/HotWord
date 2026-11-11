import { describe, expect, it } from 'vitest';
import { bisectText, chunkSegments } from '../shared/chunks';
import { ModelConfigSchema, modelDefaults } from '../shared/models';
import { chunkSize, extractionChunks } from '../server/jobs';
import { termLimit } from '../server/ai';
import { decodeReply, ModelError, OutputLimitError } from '../server/providers';

describe('输出预算与完整分片', () => {
  it('降低输出上限会缩小输入片段，所有字符仍完整参与处理', () => {
    const text = '产业协同 Industrial Collaboration 😀\n'.repeat(600);
    for (const cap of [256, 2048, 8000, 16000]) {
      const size = chunkSize({ ...modelDefaults('deepseek'), maxOutputTokens: cap });
      expect(size).toBeLessThanOrEqual(cap * 0.75);
      const chunks = chunkSegments([{ id: 's', label: '合成表格', text }], size);
      expect(chunks.map(c => c.text).join('')).toBe(text);
      expect(chunks.every(c => c.text.length <= size)).toBe(true);
    }
  });
  it('二分保留行边界、原文和 Unicode 字符，不拆开代理对', () => {
    const rows = '产业协同-Industrial Collaboration\n光伏组件-Photovoltaic Module';
    const parts = bisectText(rows)!;
    expect(parts.join('')).toBe(rows); expect(parts[0].endsWith('\n')).toBe(true);
    expect(bisectText('A😀B')?.join('')).toBe('A😀B');
    expect(bisectText('😀')).toBeNull(); expect(bisectText('字')).toBeNull();
  });
  it('换行符正好位于字符上限时不会多送一个字符', () => {
    const text = `${'字'.repeat(10)}\n下一行😀`;
    const chunks = chunkSegments([{ id: 's', label: '原文', text }], 10);
    expect(chunks.map(c => c.text).join('')).toBe(text);
    expect(chunks.every(c => c.text.length <= 10)).toBe(true);
  });
  it('短词条表同时受行数预算约束，保持每个完整双语行', () => {
    const rows = Array.from({ length: 100 }, (_, i) => `Term${i}\t词条${i}😀`), text = rows.join('\n');
    for (const cap of [256, 2048, 8000, 16000]) {
      const config = { ...modelDefaults('deepseek'), maxOutputTokens: cap };
      const chunks = extractionChunks([{ id: 's', label: '术语表', text }], config);
      const maxRows = Math.max(1, Math.floor(termLimit(config) / 2));
      expect(chunks.map(c => c.text).join('')).toBe(text);
      for (const chunk of chunks) {
        const lines = chunk.text.split('\n').filter(Boolean);
        expect(lines.length).toBeLessThanOrEqual(maxRows);
        expect(chunk.text.length).toBeLessThanOrEqual(chunkSize(config));
        expect(lines.every(line => rows.includes(line))).toBe(true);
      }
    }
  });
  it('合并短工作表不会绕过行数预算，出处标签也保持合法长度', () => {
    const segments = Array.from({ length: 80 }, (_, i) => ({ id: `${i}`, label: '工作表'.repeat(60), text: `Term${i}\t词条${i}` }));
    const chunks = extractionChunks(segments, modelDefaults('deepseek'));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(c => c.text.split('\n').length <= 38 && c.label.length <= 180)).toBe(true);
    for (const segment of segments) expect(chunks.map(c => c.text).join('')).toContain(segment.text);
  });
  it('合法模型配置仍须给实际提示词留足空间，避免产生负数分片', () => {
    const config = ModelConfigSchema.parse({ ...modelDefaults('deepseek'), contextWindow: 8192, maxOutputTokens: 6143 });
    expect(() => chunkSize(config)).toThrow('模型上下文不足');
    for (const size of [0, 1, -1, 1.5, NaN, Infinity]) expect(() => chunkSegments([{ id: 's', label: '原文', text: '😀' }], size)).toThrow(RangeError);
  });
  for (const provider of ['openai', 'claude', 'deepseek', 'zhipu', 'qwen'] as const) it(`${provider} 截断保留真实用量并标记为可拆分错误`, () => {
    const payload = provider === 'openai' ? { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }
      : provider === 'claude' ? { stop_reason: 'max_tokens' } : { choices: [{ finish_reason: 'length' }] };
    try {
      decodeReply(modelDefaults(provider), { ...payload, usage: { prompt_tokens: 123, completion_tokens: 8000, input_tokens: 123, output_tokens: 8000 } }, { input: 0, output: 0, estimated: true });
      throw new Error('expected truncation');
    } catch (e) {
      expect(e).toBeInstanceOf(OutputLimitError);
      expect(e).toMatchObject({ retryable: false, usage: { input: 123, output: 8000, estimated: false } });
    }
  });
  it('只有明确达到输出上限才可拆分，拒绝和其他 incomplete 不进入恢复', () => {
    const config = modelDefaults('openai'), usage = { input: 10, output: 8000, estimated: false };
    expect(() => decodeReply(config, { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, usage: { input_tokens: 10, output_tokens: 8000 } }, usage)).toThrow(OutputLimitError);
    try { decodeReply(config, { status: 'incomplete', incomplete_details: { reason: 'content_filter' } }, usage); throw new Error('expected failure'); }
    catch (e) { expect(e).toBeInstanceOf(ModelError); expect(e).not.toBeInstanceOf(OutputLimitError); }
  });
});

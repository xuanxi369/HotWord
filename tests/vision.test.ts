import { describe, expect, it } from 'vitest';
import { modelDefaults, type Provider } from '../shared/models';
import { visionUnavailable } from '../shared/vision';

describe('vision model admission', () => {
  it.each([
    ['deepseek', 'deepseek-flash'],
    ['deepseek', 'deepseek-v4-flash'],
    ['deepseek', 'deepseek-v4-flash-vision-exp'],
    ['deepseek', 'deepseek-v4.1-flash-1017'],
    ['qwen', 'qwen-plus'],
    ['qwen', 'qwen3.7-plus'],
    ['qwen', 'qwen3-vl-plus'],
    ['zhipu', 'glm-5.3-flash'],
    ['zhipu', 'glm-5.3-flashx'],
    ['zhipu', 'glm-4.6v'],
  ] as const)('does not block vision models or unknown IDs: %s/%s', (provider, model) => {
    expect(visionUnavailable({ ...modelDefaults(provider), model })).toBeUndefined();
  });
  it.each([
    ['deepseek', 'deepseek-v4-pro'],
    ['qwen', 'qwen-turbo'],
    ['zhipu', 'glm-4.5'],
    ['zhipu', 'glm-4.5-air'],
    ['zhipu', 'glm-4.5-flash'],
    ['zhipu', 'glm-5.3'],
  ] as const)('warns for an exact documented text-only model: %s/%s', (provider, model) => {
    expect(visionUnavailable({ ...modelDefaults(provider), model })).toContain('只支持文本');
  });
  it('does not infer capability from prefixes, future snapshots or another provider', () => {
    for (const [provider, model] of [
      ['deepseek', 'deepseek-v4-pro-vision'],
      ['qwen', 'qwen-turbo-vision'],
      ['zhipu', 'glm-5.4'],
      ['zhipu', 'glm-5.3-vision'],
      ['openai', 'deepseek-v4-pro'],
    ] as [Provider, string][]) {
      expect(visionUnavailable({ ...modelDefaults(provider), model })).toBeUndefined();
    }
    expect(visionUnavailable({ ...modelDefaults('deepseek'), model: 'DeepSeek-V4-Pro' })).toContain('只支持文本');
  });
});

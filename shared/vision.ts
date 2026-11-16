import type { ModelConfig } from './models';

/** Only reject known text-only IDs. Custom models are checked by the provider. */
export function visionUnavailable(config: ModelConfig): string | undefined {
  const model = config.model.toLowerCase();
  const textOnly = config.provider === 'qwen' && /^qwen-(?:plus|turbo|long)(?:-|$)/.test(model)
    || config.provider === 'deepseek' && /^deepseek-(?:chat|reasoner|flash|v4)(?:-|$)/.test(model)
    || config.provider === 'zhipu' && /^glm-(?:5(?:\.\d+)?|4\.5)(?:-flash|-air)?$/.test(model);
  return textOnly ? `当前模型 ${config.model} 只支持文本，座次图识别需要视觉模型。请在“模型与密钥”选择视觉模型，或使用手动分区。` : undefined;
}

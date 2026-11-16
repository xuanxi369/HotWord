import type { ModelConfig, Provider } from './models';

// Exact IDs checked against provider docs on 2026-11-16. Never infer a whole
// model family's capabilities: aliases and new variants can gain image input.
const textOnlyModels: Partial<Record<Provider, readonly string[]>> = {
  // https://api-docs.deepseek.com/quick_start/pricing/
  // Flash (including legacy V4 Flash aliases) supports images; V4 Pro does not.
  deepseek: ['deepseek-v4-pro'],
  // https://help.aliyun.com/zh/model-studio/qwen-turbo
  qwen: ['qwen-turbo'],
  // https://docs.bigmodel.cn/cn/guide/models/text/glm-4.5
  // https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3
  zhipu: ['glm-4.5', 'glm-4.5-air', 'glm-4.5-flash', 'glm-5.3'],
};

/** Only reject documented text-only IDs. Unknown models are checked by the provider. */
export function visionUnavailable(config: ModelConfig): string | undefined {
  const model = config.model.toLowerCase();
  const textOnly = textOnlyModels[config.provider]?.includes(model);
  return textOnly ? `当前模型 ${config.model} 只支持文本，座次图识别需要视觉模型。请在“模型与密钥”选择视觉模型，或使用手动分区。` : undefined;
}

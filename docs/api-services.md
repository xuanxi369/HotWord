# 团队服务与个人 API Key

沿用 Workers、Access、Workflows、D1 和私有 R2。页面增加“团队服务 / 个人 API Key”和侧栏“模型与密钥”，两种模式进入相同的提取与人工审核流程。任务固定模式和模型，失败时不自动换密钥。

## 服务商兼容

| 服务商 | 协议与官方入口 | 推荐配置 |
| --- | --- | --- |
| OpenAI / ChatGPT | api.openai.com，Responses，text.format | gpt-4.1-mini，结构化 JSON |
| Claude | api.anthropic.com，原生 Messages | claude-sonnet-4-6，提示词 JSON |
| DeepSeek | api.deepseek.com，Chat Completions | deepseek-flash / deepseek-v4-pro，JSON 模式 |
| 智谱 GLM | open.bigmodel.cn，Chat Completions | glm-5.3，JSON 模式 |
| 千问 | 百炼官方区域地址，Chat Completions | qwen-plus，JSON 模式 |

保留原有 Workers AI 作为额外团队服务。推荐模型不保证每个账号均有权限；支持手动模型 ID、输出上限、上下文和思考设置。手动模型默认使用通用提示词 JSON。首版 Claude 通过提示词生成 JSON 再做严格校验，未假设所有模型支持统一的结构化输出参数。

OpenAI API Key 来自开发者平台。Claude 支持 `anthropic-workspace-id`：绑定空间的密钥可以留空，未绑定的密钥须填工作空间。千问支持北京、新加坡、弗吉尼亚、法兰克福、东京、香港；后三个区域必须填业务空间 ID。填写空间后使用 `https://{WorkspaceId}.{region}.maas.aliyuncs.com/compatible-mode/v1`；前三个区域兼容现有 DashScope 地址。区域、模型、空间和密钥必须匹配，页面自动显示调用地址。后端拒绝第三方 Base URL、无效域名标签和重定向。

连接测试发送简短合成文本，最多 128 输出 Token，不设每日次数上限，可能产生少量个人账户费用。界面按“测试连接 → 保存配置”操作，修改配置须重新测试。测试验证模型调用权限，实际提取另行校验 JSON 和原文依据。

## Cloudflare 后台配置

网页部署按 [Cloudflare 仪表盘部署说明](../DEPLOY.md) 操作：在 D1 的 Console 应用尚未执行的数据库 SQL，不用重建已有数据库；再到 Worker → Settings → Variables and Secrets → Add → **Secret**，按需配置：

| Secret 名称 | 用途 |
| --- | --- |
| CREDENTIAL_ENCRYPTION_KEY | AES-256-GCM 主密钥，32 个随机字节的 Base64 |
| OPENAI_API_KEY | 团队 OpenAI |
| ANTHROPIC_API_KEY | 团队 Claude |
| DEEPSEEK_API_KEY | 团队 DeepSeek |
| ZHIPU_API_KEY | 团队智谱 |
| QWEN_API_KEY | 团队千问，与区域匹配 |

密钥填写在 Worker 运行时 Variables and Secrets，不是 Builds 构建变量。不要把密钥放进普通 vars、wrangler.jsonc 或 Git，部署校验拒绝配置文件里的敏感 vars。

主密钥生成一次后安全保管：

```javascript
btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
```

在自己浏览器的开发者工具 Console 生成后，将结果复制到 CREDENTIAL_ENCRYPTION_KEY 运行时 Secret，按仪表盘提示保存并发布。

保持主密钥稳定；直接替换会使旧凭据不可解密。当前没有自动重加密工具，轮换前应完成在途任务，并让成员重新保存凭据。D1 删除表示应用不可再读取，平台备份 / 历史恢复的保留期限仍由 Cloudflare 设置决定。

普通配置 `ADMIN_EMAILS` 填管理员邮箱，用英文逗号分隔。身份来自已经验证的 Access JWT，客户端不能声明管理员。仅 localhost 开发身份自动是管理员。

登录页面 → 模型与密钥 → 团队管理：分别添加服务、模型、区域与空间，可配置价格用于费用统计后开放。每日任务数、Token 和金额不设系统额度。每家服务商读取一个固定名称的团队 Secret，同商多个模型共享密钥；同商多区域需要不同密钥时，当前需独立部署。

也可用普通环境变量 `TEAM_SERVICES` 的 JSON 数组提供初始模型：

```json
[
  {"id":"team-openai","name":"团队 OpenAI","config":{"provider":"openai","model":"gpt-4.1-mini","outputMode":"json_schema","maxOutputTokens":8000}},
  {"id":"team-claude","name":"团队 Claude","config":{"provider":"claude","model":"claude-sonnet-4-6","maxOutputTokens":8000}},
  {"id":"team-deepseek","name":"团队 DeepSeek","config":{"provider":"deepseek","model":"deepseek-flash","outputMode":"json_object","thinking":"disabled","maxOutputTokens":8000}},
  {"id":"team-zhipu","name":"团队智谱","config":{"provider":"zhipu","model":"glm-5.3","outputMode":"json_object","thinking":"disabled","maxOutputTokens":8000}},
  {"id":"team-qwen","name":"团队千问","config":{"provider":"qwen","model":"qwen-plus","region":"cn-beijing","workspace":"llm-example","outputMode":"json_object","thinking":"disabled","maxOutputTokens":8000}}
]
```

千问示例 `llm-example` 必须替换成控制台实际空间。D1 中同 ID 的管理设置优先；关闭服务保存 `enabled=false`。未设置 TEAM_SERVICES 时只默认开放原有 Workers AI，其余五家由团队管理添加。未配置该家 Secret 时服务显示“密钥未配置”且无法提交任务。

## 个人密钥生命周期

- 默认“仅一次任务”：加密草稿暂存 1 小时，成功提交后删除草稿，建立任务专属加密副本。
- 主动“记住我的密钥”：加密保留到用户更换或删除。各任务有独立副本，更换 / 删除不会使已提交任务换用新密钥。
- 任务副本在完成、失败、取消后立即删除；异常时最长可解密 3 小时，每小时清理，物理清理可能延迟一个周期。
- 浏览器只保留配置 ID 与脱敏信息，明文只在密码输入框临时状态中存在，保存或关闭时清空；不会进入 localStorage / sessionStorage。
- D1 credentials / job_secrets 与术语资料分开。AES-GCM 绑定成员与引用，不同成员或引用不能解密。
- Workflows 只传任务 ID，持久步骤只保存数量、R2 键等元数据。密钥不进入 R2 输入、候选结果、审核 JSON 或应用日志。

个人密钥会经过托管后端，有部署权限的维护人员属于信任范围。个人模式只向所选服务商发送所选解析文本。

## 额度与用量

团队与个人的每日任务数、Token 和金额均不设系统额度，连接测试次数也不限。旧数据库成员额度自动按“不限”读取，无需迁移或清零用量。保留每成员同时运行 2 项任务的原子并发保护；可关闭某项团队服务停止开放。

提取分片参考模型上下文余量、单次输出容量和行数估算。8000 Token 配置下每片最多 6000 字符、38 行，所有所选原文都会参与处理。提示词要求提取全部符合条件的词条、紧凑 JSON 和最短原文证据，不再按预算只保留前几条或高优先级词条，也不设 180 条候选上限。响应中的 complete 表明提取是否完整；服务商返回输出截断或模型返回 complete=false 时，会继续多轮二分。每次二分严格缩短输入，最终完整的子片段结果按原文顺序合并；最小片段仍不能完整输出时明确失败，不导出残缺 JSON。

任务提交通过 D1 原子事务检查并发数及凭据归属。每次调用的预估用量仍会记录，响应后按实际用量结算，用量和费用不影响任务准入、重试或拆分恢复。删除任务不删除 admissions / ai_usage；任务结果保留 7 天，用量记录保留 30 天。

有效 usage 记录实际 Token；响应损坏、连接结果不确定或没有 usage 时按保守上限估计并标记。格式失败和重试也记账。金额按管理员设置的每百万 Token 美元价格估计，不自动获取价格或精确处理所有折扣 / 缓存套餐；未计价也可提取。实际账单以服务商为准。模型单次输出容量、上下文及服务商接口限制仍由所选模型和账号决定，系统通过分片处理资料。

## 验证边界

本地使用协议模拟与 SQLite 执行真实 migration / SQL，覆盖五家提取、依据校验、快照、额度、权限、失败 / 重试 / 清理及确定性 TXT。浏览器使用合成密钥、模拟连接成功；保存和脱敏查询使用真实本地 Worker / D1。没有真实付费 Key 调用或云端部署。

上线前五家分别验证连接 → 合成资料提取 → 错误反馈 → 费用归属 → 删除 / 清理。最终校验 `Somnia-梦境公链，Industrial Collaboration-产业协同`，热词 ≤ 2048、指定翻译 ≤ 20480 字符，包含 BOM / CRLF，只按完整条目取舍。

## 官方参考（2026-11-10 核对）

- [OpenAI Responses 结构化输出](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)
- [Claude 身份与工作空间](https://platform.claude.com/docs/en/manage-claude/authentication)
- [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)
- [智谱对话补全](https://docs.bigmodel.cn/api-reference/模型-api/对话补全)
- [千问区域与空间域名](https://help.aliyun.com/zh/model-studio/regions/)
- [Cloudflare Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

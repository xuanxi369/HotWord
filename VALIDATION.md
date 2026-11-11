# 本地验证记录

## 2026-11-11 输出截断修复

- `npm run check`：97 项测试通过，TypeScript 检查及前后端生产构建通过。
- 分片同时受输入字符、上下文余量和输出行数预算约束。验证换行恰好位于字符边界、密集短词条表、跨工作表合并、Unicode 代理对，以及上下文不足时明确拒绝配置。
- 模拟 100 行密集双语表：预分为 3 片，其中 2 片返回 8000 Token 截断后自动二分，7 次调用完成全部 100 条词条；验证顺序、唯一 ID、实际用量汇总、进度、余量释放和临时结果清理。
- OpenAI / Claude / DeepSeek / 智谱 / 千问的截断标记在本地 workerd / Miniflare 中识别为可拆分错误，服务商返回的 8000 Token 用量保留。另验证连接重试、拆分后仍截断时停止、失败不导出部分结果。
- 本轮使用合成文档及服务商协议响应，未调用真实付费模型，未发布到线上。旧失败任务需在发布新版本后重新提取。

## 2026-11-10 验证记录

日期：2026-11-10。以下结果属于本地验证，未创建 GitHub 远端仓库、未部署到 Cloudflare，也未调用真实计费 AI 模型。

- `npm run check`：65 项测试通过，TypeScript 检查与前后端生产构建通过。
- 本次五家服务适配、个人密钥和团队入口：使用合成协议响应，验证 Responses / Messages / Chat Completions 的请求与响应，完成实际提取、原文校验及 `Somnia-梦境公链，Industrial Collaboration-产业协同` 格式回归。真实付费服务尚未调用。
- 使用内存 SQLite 执行两份真实 D1 migration / SQL，覆盖 AES-GCM 绑定成员与引用、个人单次 / 记住密钥、并发准入、不可复用的单次密钥、额度预留与释放、团队 / 个人费用隔离、删除任务不重置每日额度、任务启动失败、重试、部分失败与过期清理。
- 真实本地 Worker / D1 配合 Chromium 验证个人保存、清空输入、脱敏列表、团队服务管理与成员额度保存。连接成功响应由浏览器模拟，使用合成密钥；本地 D1 未保存明文密钥，localStorage / sessionStorage 均无密钥。
- 新配置窗口已检查桌面与 390px 手机布局；手机弹窗宽度与 scrollWidth 均为 356px，无横向溢出。开发热更新时兼容旧额度响应，刷新后界面正常。
- `npm audit`：0 个已知漏洞。替换旧 ExcelJS 为专门的只读 XLSX 解析器，PDF.js 和 Vitest 使用已修复版本，package-lock.json 锁定依赖。
- `wrangler deploy --dry-run`：成功读取静态资源并打包 Worker、D1、R2、AI、Workflow bindings；不是线上部署。
- 本地 D1 migration 成功。通过实际 Worker HTTP 请求检查：其他成员任务返回 404，跨站 POST 返回 403，达到成员任务额度后合法来源提交返回 429；验证数据已清除。
- JWT 测试使用真实 RSA 签名，验证合法令牌、错误 audience、已过期令牌、伪造身份头、无配置和本地绕过不能用于公网。
- 真实 Chromium 浏览器读取合成 XLSX、PDF、DOCX、TXT；XLSX 工作表取消勾选生效，PDF 排除页生效。额外验证了使用 CID 中文字体的 PDF，`重庆，长寿，产业协同` 完整提取；字符映射、字体与解码器从本站提供。
- CSV 测试覆盖引号中的逗号和换行、UTF-8 BOM；DOCX 测试检查中英文段落顺序。浏览器演示可使用 `samples/双语术语示例.csv`。
- XLSX 浏览器导入后的两份实际下载 TXT：热词 225 个 UTF-16 单元、20 个完整词条；指定翻译 158 个单元、7 个完整映射，均包含 BOM+CRLF。检测到两项 `PV Frame` 冲突并隔离；`Fuzhou High tech Industrial Development Zone-福州高新技术产业开发区` 与 `Industrial Collaboration-产业协同` 完整保留。
- 桌面和 390px 手机宽度下检查了界面。大词条表在窄屏中横向滚动，主要上传及下载界面按单列展示。
- 生产构建配置保持 `AUTH_MODE=access`，开发身份不会写入前端；无 `workers.dev` 与公开预览入口。部署检查脚本要求先填写真实 D1 ID、Access 标识和受保护域名。

上线前还需验证：Cloudflare 账号中当前模型的实际可用性和输出质量、真实 Access 邮箱登录、Workflow 在云端的执行与恢复、R2 生命周期、域名，以及实际同屏翻译软件的导入。扫描件 OCR 和多人实时共同编辑不在本版功能内。

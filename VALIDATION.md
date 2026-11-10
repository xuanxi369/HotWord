# 本地验证记录

日期：2026-11-10。以下结果属于本地验证，未创建 GitHub 远端仓库、未部署到 Cloudflare，也未调用真实计费 AI 模型。

- `npm run check`：31 项测试通过，TypeScript 检查与前后端生产构建通过。
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

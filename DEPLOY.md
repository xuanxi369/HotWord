# GitHub 与 Cloudflare 部署

五家团队 Secrets、个人凭据加密主密钥、管理员名单与新增数据库迁移的完整说明见 [模型与密钥部署](docs/api-services.md)。现有生产环境必须先应用 `0002_model_credentials.sql`，再部署本次代码。

本项目已包含 Worker / Static Assets、D1 migration、私有 R2、Workflow、AI binding 和 GitHub CI 配置。部署需要你的 GitHub 仓库、Cloudflare 账号以及域名；这些信息不会从本地其他项目中猜测。

## 1. 使用 HotWord 仓库

项目根目录是 `C:\Users\杨烜曦\Desktop\HotWord`，使用该目录原有的 `.git`。当前分支为 `main`，远端 `origin` 是 `https://github.com/xuanxi369/HotWord.git`，首版项目提交已保留。

在此项目根目录运行：

```powershell
git status
git remote -v
git push -u origin main
```

不需要重新初始化仓库或添加另一个 origin。`.dev.vars`、环境密钥、上传文件和迁移元数据备份都已忽略。迁移本身未执行 push。

## 2. 创建 Cloudflare 资源

```powershell
npx wrangler login
npx wrangler d1 create glossary-studio
npx wrangler r2 bucket create glossary-studio-private
```

把 D1 命令返回的真实 `database_id` 写入 `wrangler.jsonc`。配置中的全零 ID 只是占位符，不能直接生产使用。不要修改资源 binding 名称。

```powershell
npm run db:remote
```

R2 保持私有，**不要启用 r2.dev 公共访问或公开桶域名**。推荐额外设置 8 天生命周期过期规则作为清理故障的兜底。AI、R2、Workflows 等资源可能需要在控制台启用计费；请查看当前套餐与限额，不能保证整套服务永远免费。

## 3. 域名与成员登录

1. 将域名 DNS 托管到 Cloudflare。在 Zero Trust → Access → Applications 创建 **Self-hosted** 应用，用你准备绑定的完整域名，例如 `terms.example.com`。
2. 选择 Email one-time PIN，或团队已有的 Google / Microsoft 身份提供方。
3. Allow 策略仅列出团队成员邮箱或受控的企业成员组。不要使用 Everyone / Bypass 策略；路径覆盖整个域名。
4. 获取团队域名（例如 `your-team.cloudflareaccess.com`）和该应用的 Audience（AUD）。写入 `wrangler.jsonc` 的 `ACCESS_TEAM_DOMAIN` 和 `ACCESS_AUD`。这两项是配置标识，不是 API Key。生产 `AUTH_MODE` 保持 `access`。
5. 添加 Worker 的自定义域名路由：

```jsonc
"routes": [{ "pattern": "terms.example.com", "custom_domain": true }]
```

首次部署时 Access 应用先创建，避免出现无登录的公开窗口。本项目 Worker 自身也在所有路径验证 Access JWT；`workers_dev` 和 `preview_urls` 默认关闭。

## 4. GitHub 自动构建

Cloudflare 控制台 → Workers & Pages → Create → 导入 GitHub 仓库，选择 Workers 项目：

| 项目 | 设置 |
| --- | --- |
| 根目录 | 仓库根目录 |
| 生产分支 | `main` |
| 安装命令 | `npm ci`（默认安装也可） |
| 构建命令 | `npm run check` |
| 部署命令 | `npm run validate:deploy && npx wrangler deploy` |
| Node | `22` 或 `24` |

`npm run check` 运行测试与 Vite 构建，产物在 `dist`，Cloudflare Vite plugin 输出部署配置。不要设置成 `wrangler pages deploy`，也不需要再创建独立 Pages 项目。本方案采用 Workers Builds 部署，GitHub Actions 只做检查，不同时配置第二个自动部署渠道。

确认控制台的 Worker 名称与 `wrangler.jsonc` 的 `name` 一致。生产环境不要配置 `AUTH_MODE=local`。默认 AI 通过 Cloudflare binding 使用，不需要把模型 API Key 填入前端。

后续数据库结构变动先新增 migration，再对远端应用 migration，随后合并发布代码。不要在每次 Preview 构建里修改生产数据库。

## 5. 上线验收

- 使用团队白名单成员邮箱登录，可看到工作台；未授权邮箱被拒绝。
- 正确登录后每成员只看到自己的任务；无法通过另一成员任务 ID 读取结果。
- `workers.dev` / 预览地址不可用；所有 API 都受登录保护。
- 用合成双语表导入并下载 TXT，检查格式及计数；再在实际同屏翻译软件里验证一次。
- 用一份经过授权的会议文档完成 AI 请求，确认 Qwen 模型在当前账号可用、JSON 返回解析正常、候选质量满足使用要求。
- 上传不含实际人名的资料，不应出现虚构嘉宾；有歧义的人名或译法由成员审核。
- 超过 2048 / 20480 的候选，只按完整条目取舍；必保超限禁用下载。
- 删除任务后，其 R2 文件和 D1 记录不可读取；定时清理已启用。

## 运维

AI 每片段 10000 字符、最多 180 候选，有限重试。请求额度控制费用增长，但不是固定金额预算；管理员需按 Cloudflare 当前定价设置计费通知并定期检查 AI 消耗。长任务超过 3 小时会被标记失败并清理输入。结果到期 7 天后由每小时定时任务清理，可能有不超过一个清理周期的延迟。

当前没有扫描件 OCR 和多用户同步共同编辑。若使用量增大，可增设可复用项目词库、团队权限、OCR 和外部更强的模型接口；不需要为当前上传→审核→TXT 的核心流程预先增加这些服务。

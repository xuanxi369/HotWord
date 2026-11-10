# 通过 Cloudflare 网页仪表盘部署 HotWord

使用 **Cloudflare Dashboard → Workers & Pages → 连接 GitHub → Workers Builds** 发布。资源创建、数据库 SQL、密钥管理、构建和后续发布都可以通过网页完成，不要求在个人电脑安装 Wrangler 或运行部署命令。构建表格里的命令由 Cloudflare 云端执行。

这是一个包含前端静态资源和 API 的完整 Worker 项目，部署类型选择 **Workers**。项目同时使用 Workflows、D1、R2 和 Workers AI binding。上传一个 HTML 文件或在 Quick Edit 中粘贴单个 Worker 文件，无法完成此项目部署。

## 1. 准备 GitHub 仓库

使用已有仓库 [xuanxi369/HotWord](https://github.com/xuanxi369/HotWord)，生产分支为 `main`。确认网页上已能看到本次代码，以及：

- `server/`、`src/`、`shared/` 和 `scripts/`。
- `package.json`、`package-lock.json`、`wrangler.jsonc`。
- `migrations/0001_jobs.sql` 和 `migrations/0002_model_credentials.sql`。

部署拉取的是 GitHub 内容，本地修改需要先同步到该仓库。后文的配置可直接使用 GitHub 文件页右上角的铅笔编辑，再 Commit changes 到 main。不要上传 `.dev.vars`、node_modules、真实客户资料或 API Key。

## 2. 在 Cloudflare 网页创建数据库和私有存储

登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)，选择目标账号。菜单分组可能显示为 Storage & databases 或存储与数据库。

| 位置 | 操作 | 名称 |
| --- | --- | --- |
| D1 → Create database | 创建数据库，已有部署则使用原数据库 | glossary-studio |
| D1 → 数据库 → Settings / Overview | 复制 Database ID | 真实 UUID，后面填入仓库 |
| R2 Object Storage → Create bucket | 创建桶，已有部署则使用原私有桶 | glossary-studio-private |

R2 的 Public Development URL 和 Custom Domains 保持关闭。可在桶的 Settings → Object lifecycle rules 设置 8 天过期作为清理兜底。

### 在 D1 网页 Console 应用 SQL

打开 D1 → glossary-studio → Console / SQL 控制台，先查看现有表：

```sql
SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;
```

- **全新空库**：依次打开 GitHub 上的 [0001_jobs.sql](https://github.com/xuanxi369/HotWord/blob/main/migrations/0001_jobs.sql) 和 [0002_model_credentials.sql](https://github.com/xuanxi369/HotWord/blob/main/migrations/0002_model_credentials.sql)，将每份 SQL 按顺序复制到控制台执行。
- **已有旧版 jobs 表**：保留原数据库，只执行尚未应用的 0002。先查看 `PRAGMA table_info(jobs);` 和现有迁移记录，避免重复执行 ALTER TABLE。
- **已经应用 0002**：已有 mode / model_config 列及 credentials、job_secrets、team_services、member_policies、admissions、ai_usage、connection_probes 表，不要再次执行。
- 若当前 Console 只支持单条 SQL，按分号结束的完整语句逐条执行；CREATE TABLE 里的逗号不能拆开。

0002 不是可重复执行脚本。遇到错误应核对是哪条未完成，并补齐剩余语句，不要把 “duplicate column” 一律忽略，也不要删除原表重新开始。

如果已登记 0002 但模型配置仍无法读取，必须核对实际表结构。针对已完成 jobs 新增列及前四张表、缺少 admissions / ai_usage / connection_probes 的情况，使用[部分迁移修复说明](docs/repair-model-setup.md)和专用补齐 SQL。

为了让以后使用 Wrangler migration 时能识别网页已经应用的文件，先创建迁移记录表：

```sql
CREATE TABLE IF NOT EXISTS d1_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

**只有确认对应文件全部成功执行后**，分别登记：

```sql
INSERT OR IGNORE INTO d1_migrations(name) VALUES ('0001_jobs.sql');
```

```sql
INSERT OR IGNORE INTO d1_migrations(name) VALUES ('0002_model_credentials.sql');
```

已由 Wrangler 应用并登记的 migration 不需要补登记。网页部署的默认命令不重复运行生产迁移；后续新增 migration 也应先在 D1 Console 应用，再发布依赖新结构的代码。

## 3. 在 Zero Trust 网页设置域名和成员登录

1. 使用一个已在 Cloudflare 托管 DNS 的域名，选定工作台地址，例如 `terms.example.com`。
2. Zero Trust → Access → Applications → Add an application → Self-hosted，创建覆盖这个完整域名、所有路径的应用。
3. 选择邮箱一次性验证码，或已有的 Google / Microsoft 登录方式；Allow 策略填团队成员邮箱或企业成员组。
4. 复制该应用的 Audience（AUD）。
5. 在 Zero Trust 的团队设置中取得 Team domain，例如 `your-team.cloudflareaccess.com`，只保留域名，不加 https:// 或路径。

成员登录应用应先于网站上线配置。生产保持 `AUTH_MODE=access`，workers.dev 和预览地址保持关闭。团队成员使用自定义域名登录。

## 4. 在 GitHub 网页填写普通部署配置

打开仓库根目录的 `wrangler.jsonc`，点击铅笔，将下面的占位字段改成真实值：

| 配置字段 | 值 |
| --- | --- |
| name | glossary-studio，与仪表盘 Worker 名称一致 |
| vars.AUTH_MODE | access |
| vars.ACCESS_TEAM_DOMAIN | 从 Zero Trust 复制的团队域名 |
| vars.ACCESS_AUD | 对应 Access 应用的 AUD |
| vars.ADMIN_EMAILS | 管理员邮箱，多个用英文逗号分隔 |
| d1_databases[0].database_id | 第 2 步复制的真实 D1 UUID |

在最外层 `{ ... }` 对象内添加 `routes`，例如紧接现有 `name` 字段。用你的实际域名替换示例；不要把 `routes` 放在文件开头的 `{` 外面：

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "glossary-studio",
  "routes": [
    { "pattern": "terms.example.com", "custom_domain": true }
  ],
  // 后面继续保留现有 main、vars、bindings 等字段。
  // 此片段仅示意插入位置，不要用它覆盖完整配置。
}
```

现有资源 binding 名称应保持：

| Binding | 对应资源 / 配置 |
| --- | --- |
| DB | D1 glossary-studio |
| FILES | 私有 R2 glossary-studio-private |
| EXTRACT | Workflow glossary-extraction |
| AI | Workers AI |
| ASSETS | 构建生成的前端静态资源 |

Workflow 的 `class_name` 是 `ExtractionWorkflow`，会随完整 Worker 部署创建或更新，不需要先创建一个空 Workflow。现有 `triggers.crons` 保持 `15 * * * *`。

普通变量、域名和 binding 以仓库配置为准：Wrangler 后续发布会重新应用这些值，因此不要只改仪表盘而让仓库仍留空或保留旧值。API Key 与加密主密钥使用下一节的运行时 Secret，不进入此配置文件。

## 5. 在 Cloudflare 网页连接 GitHub 并部署

进入 Workers & Pages → Create application / 创建应用 → Connect Git / Import repository，授权 GitHub 后选择 HotWord，应用类型为 Worker。

填写：

| 仪表盘项目 | 设置 |
| --- | --- |
| Worker 名称 | glossary-studio |
| Repository | xuanxi369/HotWord |
| Production branch | main |
| Root directory | 仓库根目录，通常留空或 / |
| Build command | npm run check |
| Deploy command | npm run validate:deploy && npx wrangler deploy |
| 启用预览构建 | 首版关闭，当前生产配置关闭预览地址 |
| Node 版本 | 24；也可通过 Builds 环境变量 NODE_VERSION=24 配置 |
| 安装依赖 | 默认 npm 安装流程，项目包含 package-lock.json |

如果界面提供独立 Install command，填 `npm ci`；Cloudflare 自动安装依赖时无需额外填写。无需 Pages output directory，静态资源由 Vite / Cloudflare 插件生成并随 Worker 发布。

关闭预览构建后无需填写预览命令。导入页的 Cloudflare Access 保护开关不能代替第 3 节对正式自定义域名设置的 Access 应用。

在 API token 项选择由 Cloudflare 创建构建 token；它用于云端部署，不是模型 API Key。部署自定义域名时，构建 token 需要对目标域名所在 zone 的 Workers Routes 编辑权限。若已有自定义 token，核对其 Workers Scripts、路由与资源权限。

点击 Deploy。已有 Worker 则进入它的 Settings → Builds → Connect Git，填写同样的构建设置，然后触发构建或 Retry / Redeploy。

日志中的部署校验若报告 Access 标识、D1 ID 或 custom_domain 缺失，回到 GitHub 网页修正 wrangler.jsonc 并提交，再重试。**仅创建资源并不会自动替换仓库中的占位值。**

## 6. 在 Worker 网页设置运行时 Secrets

首次完整 Worker 部署完成后，进入 Workers & Pages → glossary-studio → Settings → Variables and Secrets。点击 Add，类型选择 **Secret**，按需填写：

| Secret 名称 | 用途 |
| --- | --- |
| CREDENTIAL_ENCRYPTION_KEY | 开启个人密钥加密保存 |
| OPENAI_API_KEY | 团队 OpenAI |
| ANTHROPIC_API_KEY | 团队 Claude |
| DEEPSEEK_API_KEY | 团队 DeepSeek |
| ZHIPU_API_KEY | 团队智谱 |
| QWEN_API_KEY | 团队千问 |

填写的是 **Worker 运行时 Secrets**，不是 Settings → Builds 中的构建环境变量。模型密钥不需要提供给构建过程。

CREDENTIAL_ENCRYPTION_KEY 必须是随机 32 字节的 Base64，可在自己浏览器开发者工具 Console 中生成：

```javascript
btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
```

复制结果存入 Secret，按界面提示 Save / Save and deploy。主密钥保存后应稳定保管，直接更换会使之前保存的个人凭据无法解密。各服务商密钥从相应开发者平台取得；未配置的团队服务不会允许用户调用。

## 7. 打开域名并开放两种使用入口

1. 使用管理员邮箱打开自定义域名，通过 Access 登录。
2. 侧栏“模型与密钥” → “团队管理”：添加团队服务，选择服务商、模型、千问区域 / 业务空间或 Claude 工作空间，设置价格与成员额度，再开放。
3. “我的密钥”：成员选择服务商、输入自己的 API Key、测试连接、保存，默认仅用于一次任务；可主动选择记住。
4. 返回工作台，在“团队服务 / 个人 API Key”之间选择。提交前核对显示的模型和费用归属。

五家模型配置、密钥生命周期、额度规则见 [模型与密钥说明](docs/api-services.md)。

## 8. 网页验收与后续发布

- Worker → Bindings：核对 DB、FILES、EXTRACT、AI、ASSETS。
- Worker → Settings → Domains & Routes：自定义域名正确，workers.dev / Preview URL 关闭。
- Worker → Settings → Triggers：清理 cron 为每小时第 15 分钟，注意 Cloudflare cron 按 UTC 执行。
- 未授权邮箱被 Access 拒绝；成员只能查看自己的任务和凭据。
- 五家分别完成连接、合成资料提取、错误反馈和费用归属验证，确认失败不自动换密钥。
- 任务完成、失败或取消后，D1 的对应 job_secrets 记录应清理；删除任务不重置用量。
- 最终 TXT 校验 `Somnia-梦境公链，Industrial Collaboration-产业协同`，热词 ≤ 2048、指定翻译 ≤ 20480 字符，包含 BOM 和 CRLF。

以后 GitHub main 有新提交，Cloudflare Workers Builds 自动发布；也可以在网页 Builds 重试构建。新增数据库 migration 先应用再发布。GitHub Actions 仅运行检查，实际发布由 Cloudflare 完成。

当前本地构建和部署预演已通过。真实 Cloudflare 账号、域名、Access 与付费模型仍需按以上步骤配置和线上验收。

## 官方依据

核对日期：2026-11-10。

- [通过 Dashboard 创建 Worker](https://developers.cloudflare.com/workers/get-started/dashboard/)
- [Workers Builds 构建与部署设置](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [D1 SQL 与网页 Console](https://developers.cloudflare.com/d1/sql-api/sql-statements/)
- [D1 migration 记录](https://developers.cloudflare.com/d1/reference/migrations/)
- [Wrangler 配置与仪表盘覆盖行为](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

# 模型配置无法加载：修复部分执行的 0002 迁移

2026-11-11 通过 Cloudflare 网页对生产数据库 glossary-studio 的只读检查确认：jobs 的新增列、credentials、job_secrets、team_services、member_policies 已存在，但 admissions、ai_usage、connection_probes 缺失。d1_migrations 虽已登记 0002，实际迁移尚未完成。

这会让 `/api/models`、团队管理和任务接口报错。原页面把配置加载失败显示成持续“正在读取配置”和“个人密钥尚未启用”，不能据此判断加密主密钥是否有效。

## 当前数据库的网页修复方式

1. Cloudflare → D1 → glossary-studio → 控制台。
2. 确认缺失的是上述三张表，jobs 已有 mode、credential_id、input_tokens、output_tokens、estimated_usd 等 0002 列。
3. 打开 [补齐 SQL](sql/repair-0002-model-tables.sql)，复制完整内容执行。如果控制台仅支持单条语句，将八条以分号结尾的完整语句依次执行，不能按行拆分 CREATE TABLE。
4. 执行下面的核验 SQL，应返回三行：

```sql
SELECT name FROM sqlite_master
WHERE type='table' AND name IN ('admissions','ai_usage','connection_probes') ORDER BY name;
```

5. 刷新 HotWord。补齐数据库不需要重新部署 Worker，现有代码即可读取配置。
6. “模型与密钥” → “团队管理” → 添加 DeepSeek 服务（例如服务 ID `team-deepseek`、展示名称 `团队 DeepSeek`），选择账号实际开放的模型并保存、开放。仅在 Cloudflare 配置 DEEPSEEK_API_KEY 不会自动创建团队服务。

此 SQL 可重复执行：仅创建缺失的三张表和索引，并为已有任务补充缺失的准入记录；保留现有记录、用量、密钥与任务。不包含 DROP 或重复 ALTER，也不重新登记迁移。它只适用于本文确认的缺失状态，不能修复其他缺列或其他缺表。

不要重新执行整份 0002：已经添加的 jobs 列会重复，可能让执行再次停在中途。以后登记迁移前必须确认所有语句、表和索引都已完成。

## 发布本轮界面与诊断修复

同步本轮本地修改到 GitHub，让 Cloudflare Workers Builds 发布。新版本在配置失败时显示明确错误并允许重试；“团队管理”的部署检查可独立读取表结构，即使业务表不完整也会显示缺表、缺列、主密钥格式及绑定状态。诊断只对管理员开放，不返回任何密钥或用户资料，也不调用付费模型。

加密主密钥已存在于当前 Cloudflare 后台。是否有效应以配置成功加载后的 personalReady 或新版本部署检查为准，不能从旧页面的误报判断。若检查明确提示格式无效，再核对其是否为随机 32 字节的 Base64；已有凭据时不要随意更换主密钥。

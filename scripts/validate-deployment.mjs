import { readFile } from 'node:fs/promises';
const config = JSON.parse(await readFile(new URL('../dist/glossary_studio/wrangler.json', import.meta.url), 'utf8'));
const missing = [];
if (config.vars?.AUTH_MODE !== 'access') missing.push('生产 AUTH_MODE 必须为 access');
if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(config.vars?.ACCESS_TEAM_DOMAIN ?? '')) missing.push('填写 ACCESS_TEAM_DOMAIN');
if (!config.vars?.ACCESS_AUD) missing.push('填写 Access 应用的 ACCESS_AUD');
const databaseId = config.d1_databases?.find(db => db.binding === 'DB')?.database_id;
if (!databaseId || databaseId === '00000000-0000-0000-0000-000000000000') missing.push('替换 D1 database_id 占位符');
if (!config.routes?.some(route => route.custom_domain === true)) missing.push('添加受到 Access 保护的 custom_domain 路由');
if (config.workers_dev !== false || config.preview_urls !== false) missing.push('关闭 workers.dev 和预览地址');
if (missing.length) {
  console.error('部署配置尚未完整（修改 wrangler.jsonc 后重新构建）：\n- ' + missing.join('\n- '));
  process.exitCode = 1;
} else console.log('部署配置检查通过。');

import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, KeyRound, LoaderCircle, Plus, Settings2, ShieldCheck, Trash2, X } from 'lucide-react';
import { api } from '../api';
import { endpoint, modelDefaults, providerNames, qwenRegions, recommendedModels, type Credential, type DeploymentDiagnostics, type MemberPolicy, type ModelConfig, type ModelSelection, type ModelSettings, type Provider, type PublicService, type TeamService, type UsageSummary } from '../../shared/models';
import { Segmented } from './ui';

export function ModelFields({ value, onChange, team = false }: { value: ModelConfig; onChange: (c: ModelConfig) => void; team?: boolean }) {
  const patch = (v: Partial<ModelConfig>) => onChange({ ...value, ...v });
  const models = recommendedModels[value.provider], custom = !models.some(m => m.model === value.model);
  let address: string;
  try { address = endpoint(value); } catch { address = '请先填写该区域的业务空间 ID'; }
  return <div className="model-fields">
    <label>服务商<select value={value.provider} onChange={e => onChange(modelDefaults(e.target.value as Provider))}>{Object.entries(providerNames).filter(([p]) => team || p !== 'cloudflare').map(([p, n]) => <option key={p} value={p}>{n}</option>)}</select></label>
    <label>模型<select value={custom ? '' : value.model} onChange={e => onChange({ ...modelDefaults(value.provider, e.target.value || 'custom-model'), model: e.target.value, region: value.region, workspace: value.workspace })}>{models.map(m => <option key={m.model} value={m.model}>{m.model}</option>)}<option value="">手动填写模型 ID</option></select></label>
    {custom && <label>模型 ID<input value={value.model} maxLength={120} onChange={e => patch({ model: e.target.value })} placeholder="填写账号已开放的文本模型 ID"/></label>}
    {value.provider === 'qwen' && <label>千问区域<select value={value.region} onChange={e => patch({ region: e.target.value as ModelConfig['region'] })}>{Object.entries(qwenRegions).map(([r, n]) => <option key={r} value={r}>{n}</option>)}</select></label>}
    {['qwen', 'claude'].includes(value.provider) && <label>{value.provider === 'qwen' ? '业务空间 ID（推荐）' : '工作空间 ID'}<input value={value.workspace} maxLength={80} onChange={e => patch({ workspace: e.target.value })} placeholder={value.provider === 'qwen' ? '例如 llm-xxx；须与 API Key 区域一致' : '未绑定工作空间的密钥需填写 wrkspc_…'}/></label>}
    <p className="endpoint-note">所选服务地址：{address}</p>
    <details className="model-capabilities"><summary>模型能力与输出设置</summary><div className="model-fields">
      <label>输出格式<select value={value.outputMode} onChange={e => patch({ outputMode: e.target.value as ModelConfig['outputMode'] })}>
        <option value="prompt">提示词 JSON（通用）</option>{value.provider !== 'claude' && <option value="json_object">JSON 模式</option>}{['openai', 'qwen', 'cloudflare'].includes(value.provider) && <option value="json_schema">结构化 JSON</option>}
      </select></label>
      <label>输出 Token 上限<input type="number" min={256} max={16000} value={value.maxOutputTokens} onChange={e => patch({ maxOutputTokens: Number(e.target.value) })}/></label>
      <label>上下文 Token 长度<input type="number" min={8192} max={2000000} value={value.contextWindow} onChange={e => patch({ contextWindow: Number(e.target.value) })}/></label>
      {['deepseek', 'zhipu', 'qwen'].includes(value.provider) && <label>思考模式<select value={value.thinking} onChange={e => patch({ thinking: e.target.value as ModelConfig['thinking'] })}><option value="default">按服务商默认</option><option value="disabled">关闭</option><option value="enabled">开启</option></select></label>}
    </div><p>手动填写模型时按通用设置开始。请按所选模型实际支持的能力调整；连接测试只验证模型可调用，实际提取还会校验 JSON 与原文依据。</p></details>
  </div>;
}
function Usage({ rows }: { rows: UsageSummary[] }) {
  return <div className="model-usage">{rows.map(r => <div key={r.mode}><b>{r.mode === 'team' ? '团队服务' : '个人服务'} · 过去 24 小时</b><span>{r.tasks} 个任务 · 输入 {r.input_tokens.toLocaleString()} / 输出 {r.output_tokens.toLocaleString()} Token</span><small>{r.estimated_usd === null ? '未配置价格' : `已计价部分预估 $${r.estimated_usd.toFixed(4)}`}{r.unpriced_calls > 0 ? ` · ${r.unpriced_calls} 次调用未计价` : ''}{r.estimated_calls > 0 ? ` · ${r.estimated_calls} 次用量按上限估计` : ''}</small></div>)}</div>;
}
export function ModelPanel({ settings, loading, loadError, selection, onSelect, open, onOpenChange, refresh, admin }: {
  settings?: ModelSettings; selection?: ModelSelection; onSelect: (s: ModelSelection) => void;
  loading: boolean; loadError: string;
  open: boolean; onOpenChange: (open: boolean) => void; refresh: () => Promise<void>; admin: boolean;
}) {
  const [tab, setTab] = useState('personal'), [config, setConfig] = useState(modelDefaults('openai'));
  const [key, setKey] = useState(''), [name, setName] = useState('我的 OpenAI'), [remember, setRemember] = useState(false);
  const [editing, setEditing] = useState<string>(), [tested, setTested] = useState(''), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(''), [error, setError] = useState('');
  const mode = selection?.mode ?? 'team';
  const service = selection?.mode === 'team' ? settings?.services.find(s => s.id === selection.serviceId) : undefined;
  const credential = selection?.mode === 'personal' ? settings?.credentials.find(s => s.id === selection.credentialId) : undefined;
  const payload = { name, config, apiKey: key, remember }, fingerprint = JSON.stringify(payload);
  useEffect(() => { if (!open) { setKey(''); setTested(''); setError(''); setMessage(''); } }, [open]);
  async function action(fn: () => Promise<void>) { setBusy(true); setError(''); setMessage(''); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  function edit(c: Credential) { setEditing(c.id); setName(c.name); setConfig(c.config); setRemember(c.remember); setKey(''); setTested(''); setMessage(''); setError(''); }
  return <>
    <div id="model-panel" className="model-panel">
      <div className="model-panel-heading"><span><KeyRound size={17}/><b>本次使用的 AI 服务</b></span><button className="text-button" onClick={() => onOpenChange(true)}><Settings2 size={14}/>模型与密钥</button></div>
      <Segmented value={mode} label="AI 使用模式" options={[{ value: 'team', label: '团队服务' }, { value: 'personal', label: '个人 API Key' }]} onChange={v => {
        if (v === 'team') onSelect({ mode: 'team', serviceId: settings?.services.find(s => s.ready)?.id ?? '' });
        else { onSelect({ mode: 'personal', credentialId: settings?.credentials[0]?.id ?? '' }); if (!settings?.credentials.length) onOpenChange(true); }
      }}/>
      <label className="model-choice">{mode === 'team' ? '团队开放的模型' : '我的个人配置'}<select aria-label="本次 AI 配置" disabled={!settings || loading || !!loadError} value={mode === 'team' ? service?.id ?? '' : credential?.id ?? ''} onChange={e => onSelect(mode === 'team' ? { mode: 'team', serviceId: e.target.value } : { mode: 'personal', credentialId: e.target.value })}>
        <option value="" disabled>{loading ? '正在读取配置…' : loadError ? '配置加载失败，请重试' : settings ? '请选择服务配置' : '配置尚未加载'}</option>
        {mode === 'team' ? settings?.services.map(s => <option key={s.id} value={s.id} disabled={!s.ready}>{s.name} · {s.config.model}{s.ready ? '' : '（未配置密钥）'}</option>) : settings?.credentials.map(c => <option key={c.id} value={c.id}>{c.name} · {c.config.model} · {c.masked_key}</option>)}
      </select></label>
      {loadError && <div className="model-load-error"><p className="error-text" role="alert">{loadError}</p><button className="text-button" disabled={loading} onClick={() => { refresh().catch(() => {}); }}>重新读取配置</button></div>}
      <p className="model-billing"><ShieldCheck size={14}/>{service ? `团队服务 · ${providerNames[service.config.provider]} · ${service.config.model}；费用由团队承担。` : credential ? `个人服务 · ${providerNames[credential.config.provider]} · ${credential.config.model}；本次调用使用你的 API Key。` : mode === 'personal' ? '先在“模型与密钥”中测试并保存个人配置。' : '选择团队已开放的服务后开始提取。'}</p>
      {settings && <small className="model-quota">团队每日额度：{settings.policy.teamDailyTasks} 个任务 · 输入 {settings.policy.teamDailyInput.toLocaleString()} / 输出 {settings.policy.teamDailyOutput.toLocaleString()} Token{settings.policy.teamDailyUsd === null ? '' : ` · $${settings.policy.teamDailyUsd}`}。平台限制：每天 {settings.platformDailyTasks} 个任务、同时 {settings.platformConcurrency} 个。预留用量包含自动拆分和连接重试，任务结束后释放余量。</small>}
      {settings?.available && <small className="model-quota">当前团队可用：{settings.available.teamTasks} 个任务 · 输入 {settings.available.teamInput.toLocaleString()} / 输出 {settings.available.teamOutput.toLocaleString()} Token{settings.available.teamUsd === null ? '' : ` · 预估 $${settings.available.teamUsd.toFixed(4)}`}。平台剩余 {settings.available.platformTasks} 个任务、{settings.available.concurrency} 个并发位置。</small>}
    </div>
    <Dialog.Root open={open} onOpenChange={v => { if (!busy) onOpenChange(v); }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content model-dialog" onPointerDownOutside={e => { if (busy) e.preventDefault(); }} onEscapeKeyDown={e => { if (busy) e.preventDefault(); }}>
      <Dialog.Title>模型与密钥</Dialog.Title><Dialog.Description>选择自己的 API Key 或团队服务。新设置只影响之后提交的任务。</Dialog.Description>
      <button className="dialog-close icon-button" aria-label="关闭模型配置" disabled={busy} onClick={() => onOpenChange(false)}><X size={18}/></button>
      {admin && <Segmented value={tab} label="模型设置页面" options={[{ value: 'personal', label: '我的密钥' }, { value: 'admin', label: '团队管理' }]} onChange={v => { if (!busy) setTab(v); }}/>}
      {tab === 'personal' ? <>
        <div className="key-notice"><ShieldCheck size={17}/><p>个人密钥会经过我们托管的后端，由后端加密保存和调用；有部署权限的维护人员属于信任范围。浏览器不长期保存明文密钥。</p></div>
        {loadError ? <div className="model-load-error"><p className="error-text" role="alert">配置读取失败，暂时无法确认个人密钥服务状态。{loadError}</p><button className="text-button" disabled={loading} onClick={() => action(refresh)}>重新读取配置</button></div>
          : !settings ? <p role="status">{loading ? '正在读取个人密钥配置…' : '请先读取服务配置。'}</p>
          : !settings.personalReady && <p className="error-text" role="alert">{admin ? '个人密钥加密服务尚未就绪，请在“团队管理”的部署检查中核对主密钥状态。' : '个人密钥加密服务尚未就绪，请联系管理员核对加密配置。'}</p>}
        <div className="credential-list">{settings?.credentials.map(c => <div key={c.id}><div><b>{c.name}</b><small>{providerNames[c.config.provider]} · {c.config.model} · {c.masked_key}<br/>{c.remember ? '已加密记住' : `仅一次任务 · ${new Date(c.expires_at!).toLocaleTimeString('zh-CN')} 前提交`}</small></div><div className="credential-actions">
          <button className="text-button" disabled={busy} onClick={() => { onSelect({ mode: 'personal', credentialId: c.id }); onOpenChange(false); }}>使用</button>
          <button className="text-button" disabled={busy} onClick={() => action(async () => { await api('/api/credentials/test', { method: 'POST', body: JSON.stringify({ credentialId: c.id }) }); setMessage('已保存配置连接成功'); })}>测试</button>
          <button className="text-button" disabled={busy} onClick={() => edit(c)}>更换</button><button className="icon-button" disabled={busy} aria-label={`删除密钥配置 ${c.name}`} onClick={() => action(async () => {
            await api(`/api/credentials/${c.id}`, { method: 'DELETE' }); await refresh(); if (selection?.mode === 'personal' && selection.credentialId === c.id) onSelect({ mode: 'personal', credentialId: '' }); setMessage('密钥配置已删除；正在执行的任务保留独立副本直到任务结束');
          })}><Trash2 size={14}/></button>
        </div></div>)}</div>
        <fieldset disabled={busy || loading || !!loadError || !settings?.personalReady} className="key-form"><legend>{editing ? '更换个人配置' : '添加个人配置'}</legend>
          <label>配置名称<input value={name} maxLength={80} onChange={e => setName(e.target.value)}/></label><ModelFields value={config} onChange={setConfig}/>
          {config.provider === 'openai' && <small>使用 OpenAI 开发者平台 API Key。ChatGPT 订阅账号不能直接作为 API Key。</small>}
          <label>API Key<input type="password" autoComplete="off" spellCheck={false} value={key} maxLength={1024} onChange={e => setKey(e.target.value)} placeholder="输入服务商官方 API Key"/></label>
          <label className="remember-key"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)}/>记住我的密钥（可随时更换或删除）</label>
          <p className="form-help">默认仅用于一个任务，提交前最多暂存 1 小时；提交后随任务结束清理，异常任务最多保留 3 小时，定时清理可能延迟一个小时。测试连接可能产生少量服务商费用。</p>
          <div className="model-buttons"><button className="button secondary" disabled={!key.trim() || !name.trim() || !config.model} onClick={() => action(async () => {
            await api('/api/credentials/test', { method: 'POST', body: fingerprint }); setTested(fingerprint); setMessage('连接成功，可以保存配置');
          })}>{busy ? <LoaderCircle size={15} className="spin"/> : <Check size={15}/>}测试连接</button><button className="button primary" disabled={tested !== fingerprint} onClick={() => action(async () => {
            const saved = await api<Credential>(editing ? `/api/credentials/${editing}` : '/api/credentials', { method: editing ? 'PUT' : 'POST', body: fingerprint });
            setKey(''); setTested(''); setEditing(undefined); setRemember(false); await refresh(); onSelect({ mode: 'personal', credentialId: saved.id }); setMessage('个人配置已加密保存，并设为本次使用的服务');
          })}>保存配置</button>{editing && <button className="text-button" onClick={() => { setEditing(undefined); setKey(''); setTested(''); }}>取消更换</button>}</div>
        </fieldset>
        {settings && <Usage rows={settings.usage}/>}
      </> : <TeamAdmin refresh={refresh}/>}
      {error && <p className="error-text" role="alert">{error}</p>}{message && <p className="model-success" role="status"><Check size={14}/>{message}</p>}
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </>;
}
type AdminSettings = { services: PublicService[]; policies: MemberPolicy[]; members: string[]; usage: UsageSummary[] };
function TeamAdmin({ refresh }: { refresh: () => Promise<void> }) {
  const [data, setData] = useState<AdminSettings>(), [service, setService] = useState<TeamService>({ id: '', name: '', enabled: true, config: modelDefaults('openai'), inputUsdPerMillion: null, outputUsdPerMillion: null });
  const [member, setMember] = useState<MemberPolicy>({ email: '', teamDailyTasks: 20, teamDailyInput: 2000000, teamDailyOutput: 1000000, teamDailyUsd: null });
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [diagnostics, setDiagnostics] = useState<DeploymentDiagnostics>(), [diagnosticError, setDiagnosticError] = useState(''), [checking, setChecking] = useState(false);
  async function checkDeployment() {
    setChecking(true); setDiagnosticError('');
    try { setDiagnostics(await api<DeploymentDiagnostics>('/api/admin/diagnostics')); }
    catch (e) { setDiagnosticError((e as Error).message); }
    finally { setChecking(false); }
  }
  const load = async () => setData(await api<AdminSettings>('/api/admin/models'));
  async function reloadModels() { setBusy(true); setError(''); try { await load(); await refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  useEffect(() => { load().catch(e => setError(e.message)); checkDeployment(); }, []);
  async function save(path: string, payload: unknown) { setBusy(true); setError(''); setMessage(''); try { await api(path, { method: 'PUT', body: JSON.stringify(payload) }); await load(); await refresh(); setMessage('团队设置已保存'); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <div className="team-admin"><p className="form-help">团队 API Key 在 Cloudflare Worker 的 Settings → Variables and Secrets 中配置。这里管理开放的服务、模型与额度。管理员身份由 ADMIN_EMAILS 配置。</p>
    <div className="deployment-check"><div className="model-panel-heading"><b>部署检查</b><button className="text-button" disabled={checking} onClick={checkDeployment}>{checking ? '检查中…' : '重新检查'}</button></div>
      {diagnostics && <>
        <p>数据库：{{ ready: '结构完整', incomplete: '迁移未完成', unavailable: '暂时无法读取', missing_binding: '未绑定 DB' }[diagnostics.database.status]}</p>
        {!!diagnostics.database.missingTables.length && <p className="error-text">缺少表：{diagnostics.database.missingTables.join('、')}</p>}
        {!!diagnostics.database.missingColumns.length && <p className="error-text">缺少列：{diagnostics.database.missingColumns.join('、')}</p>}
        {diagnostics.database.status === 'incomplete' && <p className="form-help">请在 Cloudflare D1 控制台补齐尚未完成的迁移。迁移登记记录不能代替实际表结构检查。</p>}
        <p>个人密钥加密：{{ ready: '主密钥格式有效', missing: '缺少 CREDENTIAL_ENCRYPTION_KEY', invalid: '主密钥格式无效，须为随机 32 字节的 Base64' }[diagnostics.encryption]}</p>
        <p>资源绑定：{Object.entries(diagnostics.bindings).map(([name, ready]) => `${name} ${ready ? '已绑定' : '未绑定'}`).join(' · ')}</p>
        <p>团队密钥：{Object.entries(diagnostics.teamKeys).map(([p, ready]) => `${providerNames[p as Provider]} ${ready ? '已配置' : '未配置'}`).join(' · ')}</p>
        <small>这里只检查配置状态，不调用模型、不产生服务商费用。团队密钥配置后，仍需在下方添加并开放对应的团队服务。</small>
      </>}
      {diagnosticError && <p className="error-text" role="alert">{diagnosticError}</p>}
    </div>
    <div className="team-service-list">{data?.services.map(s => <button key={s.id} disabled={busy} onClick={() => { const { ready: _ready, ...editable } = s; setService(editable); }}><b>{s.name}</b><small>{s.config.model} · {s.enabled ? '开放' : '关闭'} · {s.ready ? '密钥已配置' : '密钥未配置'}</small></button>)}<button disabled={busy} onClick={() => setService({ id: '', name: '', enabled: true, config: modelDefaults('openai'), inputUsdPerMillion: null, outputUsdPerMillion: null })}><Plus size={15}/>添加服务</button></div>
    <fieldset disabled={busy} className="key-form"><legend>团队服务</legend><div className="model-fields"><label>服务 ID<input value={service.id} maxLength={60} placeholder="例如 team-openai" onChange={e => setService({ ...service, id: e.target.value })}/></label><label>展示名称<input value={service.name} maxLength={80} onChange={e => setService({ ...service, name: e.target.value })}/></label></div>
      <ModelFields team value={service.config} onChange={config => setService({ ...service, config })}/><div className="model-fields">
        <label>每百万输入 Token 美元<input type="number" min={0} step="any" value={service.inputUsdPerMillion ?? ''} placeholder="留空表示未配置价格" onChange={e => setService({ ...service, inputUsdPerMillion: e.target.value === '' ? null : Number(e.target.value) })}/></label>
        <label>每百万输出 Token 美元<input type="number" min={0} step="any" value={service.outputUsdPerMillion ?? ''} placeholder="留空表示未配置价格" onChange={e => setService({ ...service, outputUsdPerMillion: e.target.value === '' ? null : Number(e.target.value) })}/></label>
      </div><label className="remember-key"><input type="checkbox" checked={service.enabled} onChange={e => setService({ ...service, enabled: e.target.checked })}/>向成员开放此服务</label><button className="button primary" disabled={!service.id || !service.name} onClick={() => save('/api/admin/models', service)}>保存团队服务</button>
    </fieldset>
    <fieldset disabled={busy} className="key-form"><legend>成员团队额度</legend><label>成员邮箱<input type="email" value={member.email} list="known-members" onChange={e => { const existing = data?.policies.find(p => p.email === e.target.value); setMember(existing ?? { ...member, email: e.target.value }); }}/></label><datalist id="known-members">{[...new Set([...(data?.members ?? []), ...(data?.policies.map(p => p.email) ?? [])])].map(email => <option key={email} value={email}/>)}</datalist>
      <div className="model-fields">{([['teamDailyTasks', '每日任务数'], ['teamDailyInput', '每日输入 Token'], ['teamDailyOutput', '每日输出 Token'], ['teamDailyUsd', '每日美元（可留空）']] as const).map(([key, label]) => <label key={key}>{label}<input type="number" min={0} step={key === 'teamDailyUsd' ? 'any' : 1} value={member[key] ?? ''} onChange={e => setMember({ ...member, [key]: key === 'teamDailyUsd' && e.target.value === '' ? null : Number(e.target.value) })}/></label>)}</div>
      <p className="form-help">按过去 24 小时统计。个人服务不消耗团队额度，所有模式仍受平台每天 30 项、同时 2 项及全站每天 200 项限制。金额是按管理员配置价格计算的估计，实际账单以服务商为准。</p><button className="button primary" disabled={!member.email} onClick={() => save('/api/admin/policies', member)}>保存成员额度</button>
    </fieldset>{data && <Usage rows={data.usage}/>}{error && <div className="model-load-error"><p className="error-text" role="alert">{error}</p><button className="text-button" disabled={busy} onClick={reloadModels}>重新读取团队配置</button></div>}{message && <p className="model-success" role="status">{message}</p>}
  </div>;
}

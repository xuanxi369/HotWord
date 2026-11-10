import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { ArrowDown, ArrowLeftRight, ArrowRight, Check, ChevronLeft, ChevronRight, Copy, Download, FileCheck2, FileText, FolderOpen, Globe2, KeyRound, Layers3, LoaderCircle, Plus, RefreshCw, Search, ShieldCheck, Sparkles, Trash2, UploadCloud, X } from 'lucide-react';
import { api } from './api';
import { CandidateSchema, categoryNames, type Candidate, type Category, type ExtractionResult, type Job, type ParsedFile } from '../shared/schema';
import { compileHotwords, compileTranslations, fileText, validateExport, type Compiled } from '../shared/compiler';
import { importTable } from '../shared/table-import';
import { AnimatedNumber, ConfirmDialog, Disclosure, PrioritySlider, Segmented, Switch, Tip, Toggle, spring } from './components/ui';
import { ModelPanel } from './components/ModelSettings';
import { providerNames, type ModelSelection, type ModelSettings } from '../shared/models';

type User = { email: string; local: boolean; role: 'admin' | 'member' };
type Toast = { id: number; message: string; action?: () => void };
type Stage = 1 | 2 | 3;
const demo: Candidate[] = [
  { source: '重庆', target: 'Chongqing', category: 'place' },
  { source: '长寿', target: 'Changshou', category: 'place' },
  { source: 'CPIC', target: '国际复材', category: 'company' },
  { source: 'Fuzhou High-tech Industrial Development Zone', target: '福州高新技术产业开发区', category: 'place' },
  { source: 'Industrial Collaboration', target: '产业协同', category: 'industry' },
  { source: 'Direct Roving', target: '直接纱', category: 'industry' },
].map((c, i) => ({ ...c, id: `example-${i}`, priority: 80, basis: 'manual', evidence: '格式演示数据，请勿作为实际会议词库', location: '演示', hot: true, translation: true, pinned: false } as Candidate));
function download(name: string, content: string, json = false) {
  const url = URL.createObjectURL(new Blob([content], { type: json ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const safeName = (name: string) => name.replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').trim().slice(0, 80) || '项目';
const letter = (i: number): string => i < 26 ? String.fromCharCode(65 + i) : letter(Math.floor(i / 26) - 1) + letter(i % 26);
const statusNames = { queued: '排队中', running: '提取中', completed: '已完成', failed: '失败' };

export default function App() {
  const [user, setUser] = useState<User>();
  const [modelSettings, setModelSettings] = useState<ModelSettings>(), [selection, setSelection] = useState<ModelSelection>();
  const [modelsLoading, setModelsLoading] = useState(true), [modelsError, setModelsError] = useState('');
  const [modelOpen, setModelOpen] = useState(false);
  const [error, setError] = useState(''), [name, setName] = useState('');
  const [parsed, setParsed] = useState<ParsedFile>();
  const [selected, setSelected] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]), [activeJob, setActiveJob] = useState<Job>();
  const [sourceColumn, setSourceColumn] = useState(0), [targetColumn, setTargetColumn] = useState(1);
  const [skipHeader, setSkipHeader] = useState(true), [bidirectional, setBidirectional] = useState(false);
  const [query, setQuery] = useState(''), [category, setCategory] = useState('all');
  const [view, setView] = useState<'all' | 'review' | 'excluded'>('all');
  const [page, setPage] = useState(0), [example, setExample] = useState(false);
  const [stage, setStage] = useState<Stage>(1), [reviewReady, setReviewReady] = useState(false);
  const [dragging, setDragging] = useState(false), [sourceOpen, setSourceOpen] = useState(false), [warningsOpen, setWarningsOpen] = useState(false);
  const [toast, setToast] = useState<Toast>();
  const [pendingDelete, setPendingDelete] = useState<Job>(), [deleting, setDeleting] = useState(false);
  const input = useRef<HTMLInputElement>(null), projectInput = useRef<HTMLInputElement>(null);
  const parseWorker = useRef<Worker | null>(null);
  const sections = { 1: useRef<HTMLElement>(null), 2: useRef<HTMLElement>(null), 3: useRef<HTMLElement>(null) };
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
  const reduced = useReducedMotion();
  const segments = useMemo(() => parsed?.segments.filter(s => selected.includes(s.id)) ?? [], [parsed, selected]);
  const chars = segments.reduce((n, s) => n + s.text.length, 0);
  const tableMode = segments.some(s => s.rows);
  const columns = Math.max(2, ...segments.flatMap(s => s.rows?.slice(0, 10).map(r => r.length) ?? []));
  const hot = useMemo(() => compileHotwords(candidates), [candidates]);
  const translations = useMemo(() => compileTranslations(candidates, bidirectional), [candidates, bidirectional]);
  const excluded = [...hot.excluded, ...translations.excluded];
  const excludedIds = new Set(excluded.map(e => e.id));
  const needsReview = (c: Candidate) => c.basis === 'suggested' || /[/／]/.test(c.source + c.target);
  const visible = candidates.filter(c => (!query || `${c.source} ${c.target} ${c.location}`.toLowerCase().includes(query.toLowerCase()))
    && (category === 'all' || c.category === category)
    && (view === 'all' || (view === 'review' ? needsReview(c) : excludedIds.has(c.id))));
  const pages = Math.ceil(visible.length / 30);
  const running = !!activeJob && ['queued', 'running'].includes(activeJob.status);
  const modelReady = !modelsLoading && !modelsError && (selection?.mode === 'team' ? !!modelSettings?.services.some(s => s.id === selection.serviceId && s.ready) : !!modelSettings?.personalReady && !!modelSettings.credentials.some(c => c.id === selection?.credentialId));
  useEffect(() => { setPage(0); }, [query, category, view]);
  useEffect(() => { setPage(p => Math.min(p, Math.max(0, pages - 1))); }, [pages]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(undefined), toast.action ? 10000 : 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  function notify(message: string, action?: () => void) { setToast({ id: Date.now(), message, action }); }
  function resetFilters() { setQuery(''); setCategory('all'); setView('all'); setPage(0); }
  function goTo(next: Stage) { setStage(next); sections[next].current?.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'start' }); }
  function ready(terms: Candidate[], nextWarnings: string[]) {
    setCandidates(terms); setWarnings(nextWarnings); setReviewReady(true); setStage(2); setExample(false); setToast(undefined); resetFilters();
  }
  async function refreshJobs() { setJobs(await api<Job[]>('/api/jobs')); }
  async function refreshModels() {
    setModelsLoading(true); setModelsError('');
    try {
      const next = await api<ModelSettings>('/api/models'); setModelSettings(next);
      setError(current => current === modelsError ? '' : current);
      setSelection(current => current ?? { mode: 'team', serviceId: next.services.find(s => s.ready)?.id ?? '' });
    } catch (e) { setModelSettings(undefined); setModelsError((e as Error).message); throw e; }
    finally { setModelsLoading(false); }
  }
  useEffect(() => {
    api<User>('/api/me').then(setUser).catch(e => setError(e.message));
    refreshJobs().catch(() => {});
    refreshModels().catch(e => setError(e.message));
    return () => { parseWorker.current?.terminate(); };
  }, []);
  useEffect(() => {
    if (!activeJob || !['queued', 'running'].includes(activeJob.status)) return;
    const timer = window.setTimeout(async () => {
      try {
        const job = await api<Job>(`/api/jobs/${activeJob.id}`); setActiveJob(job);
        if (job.status === 'completed') {
          const result = await api<ExtractionResult>(`/api/jobs/${job.id}/result`);
          ready(result.candidates, result.warnings); notify('候选词已就绪，请审核译法'); await refreshJobs(); await refreshModels();
        } else if (job.status === 'failed') { setError(job.error || '任务失败'); await refreshJobs(); await refreshModels(); }
      } catch (e) { setError((e as Error).message); setActiveJob(undefined); }
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [activeJob]);
  async function readFile(file: File) {
    parseWorker.current?.terminate();
    setBusy(true); setError(''); setParsed(undefined); setSelected([]); setDragging(false); setToast(undefined); setStage(1);
    const worker = new Worker(new URL('./parser.worker.ts', import.meta.url), { type: 'module' });
    parseWorker.current = worker;
    const timeout = window.setTimeout(() => { worker.terminate(); setBusy(false); setError('读取超过 90 秒，请拆分文件或检查文件是否损坏'); }, 90000);
    worker.onmessage = (event: MessageEvent<{ ok: boolean; file?: ParsedFile; error?: string }>) => {
      window.clearTimeout(timeout); worker.terminate(); setBusy(false);
      if (!event.data.ok || !event.data.file) { setError(event.data.error || '读取失败'); return; }
      const result = event.data.file;
      setParsed(result); setSelected(result.segments.filter(s => s.text.trim()).map(s => s.id));
      setName(file.name.replace(/\.[^.]+$/, '').slice(0, 100)); setWarnings(result.warnings);
      setCandidates([]); setActiveJob(undefined); setExample(false); setReviewReady(false); setSourceOpen(false); resetFilters();
      notify(`已读取 ${result.segments.length} 项内容`);
    };
    worker.onerror = () => { window.clearTimeout(timeout); worker.terminate(); setBusy(false); setError('文件读取失败，请检查格式或改用 TXT'); };
    worker.postMessage(file);
  }
  function directImport() {
    setError('');
    if (sourceColumn === targetColumn) { setError('原词列和译文列不能相同'); return; }
    const result = importTable(segments, sourceColumn, targetColumn, skipHeader);
    if (!result.candidates.length) { setError('所选工作表及列中没有可导入的词条'); return; }
    ready(result.candidates, [...(parsed?.warnings ?? []), ...result.warnings]); notify(`已导入 ${result.candidates.length} 条完整词条`);
  }
  async function extract() {
    setBusy(true); setError('');
    try {
      const created = await api<{ id: string }>('/api/jobs', { method: 'POST', body: JSON.stringify({ name, selection, segments: segments.map(({ id, label, text }) => ({ id, label, text })) }) });
      setCandidates([]); setExample(false); setReviewReady(false); setToast(undefined);
      setActiveJob(await api<Job>(`/api/jobs/${created.id}`)); await refreshJobs(); await refreshModels();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function openJob(job: Job) {
    if (busy || running) return;
    setName(job.name); setActiveJob(job); setError(''); setParsed(undefined); setSelected([]); setCandidates([]); setReviewReady(false); setWarnings([]); setExample(false); setStage(1); setToast(undefined);
    if (job.status === 'failed') setError(job.error || '任务失败，请重新上传资料后重试');
    if (job.status === 'completed') {
      try { const result = await api<ExtractionResult>(`/api/jobs/${job.id}/result`); ready(result.candidates, result.warnings); }
      catch (e) { setError((e as Error).message); }
    }
  }
  async function deleteJob() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api(`/api/jobs/${pendingDelete.id}`, { method: 'DELETE' });
      if (activeJob?.id === pendingDelete.id) setActiveJob(undefined);
      await refreshJobs(); setPendingDelete(undefined); notify('云端任务及文件已删除');
    } catch (e) { setError((e as Error).message); }
    finally { setDeleting(false); }
  }
  function update(id: string, patch: Partial<Candidate>) { setCandidates(c => c.map(term => term.id === id ? { ...term, ...patch } : term)); }
  function removeTerm(term: Candidate) {
    const index = candidates.findIndex(c => c.id === term.id);
    setCandidates(all => all.filter(c => c.id !== term.id));
    notify(`已移除「${term.source}」`, () => {
      setCandidates(all => { if (all.some(c => c.id === term.id)) return all; const next = [...all]; next.splice(Math.min(index, next.length), 0, term); return next; });
      notify('词条已恢复');
    });
  }
  async function exportTxt(kind: 'hot' | 'translation', compiled: Compiled, copy = false) {
    try {
      if (compiled.errors.length) throw new Error(compiled.errors.join('；'));
      validateExport(compiled.content, kind);
      const title = kind === 'hot' ? '热词清单' : '指定翻译';
      if (copy) { await navigator.clipboard.writeText(compiled.content); notify(`${title}已复制`); }
      else { download(`${title}_${safeName(name)}.txt`, fileText(compiled.content)); notify(`${title} TXT 已生成`); }
      setStage(3);
    } catch (e) { setError((e as Error).message); }
  }
  function saveProject() { download(`审核项目_${safeName(name)}.json`, JSON.stringify({ version: 1, name, candidates }, null, 2), true); notify('审核项目已保存，可稍后导入继续编辑'); }
  async function importProject(file: File) {
    try {
      if (file.size > 5_000_000) throw new Error('审核项目文件过大');
      const result = JSON.parse(await file.text());
      if (result.version !== 1 || !Array.isArray(result.candidates) || result.candidates.length > 20000 || typeof result.name !== 'string') throw new Error('不是有效的词准项目');
      const terms = result.candidates.map((c: unknown) => CandidateSchema.parse(c));
      if (new Set(terms.map((c: Candidate) => c.id)).size !== terms.length) throw new Error('项目内存在重复词条 ID');
      ready(terms, []); setName(result.name.slice(0, 100)); setParsed(undefined); setSelected([]); setActiveJob(undefined); setError(''); notify('审核项目已恢复');
    } catch { setError('项目文件无效，请导入由本工具保存的 JSON 审核项目'); }
  }
  function showExample() { ready(demo, []); setName('格式示例'); setParsed(undefined); setSelected([]); setActiveJob(undefined); setExample(true); setError(''); }

  return <MotionConfig reducedMotion="user" transition={reduced ? { duration: 0 } : spring}><Tooltip.Provider delayDuration={450}><div className="layout">
    <aside className="sidebar">
      <a className="brand" href="#workspace" aria-label="HotWord 工作台"><span className="brand-mark"><Layers3 size={21}/></span><strong>HotWord<span>会议术语工作台</span></strong></a>
      <div className="workspace-label">WORKSPACE <span>团队版</span></div>
      <button className="nav-item active" onClick={() => document.getElementById('workspace')?.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth' })}><Layers3 size={17}/>术语工作台<span className="nav-dot"/></button>
      <button className="nav-item" disabled={busy || running} onClick={() => projectInput.current?.click()}><FolderOpen size={17}/>导入审核项目<span className="nav-shortcut">JSON</span></button>
      <button className="nav-item" onClick={() => setModelOpen(true)}><KeyRound size={17}/>模型与密钥</button>
      <div className="history-heading">我的近期任务<Tip text="刷新云端任务"><button className="icon-button" aria-label="刷新任务" onClick={() => refreshJobs().catch(e => setError(e.message))}><RefreshCw size={14}/></button></Tip></div>
      <div className="history">{jobs.length ? jobs.map(job => <div className={`job ${activeJob?.id === job.id ? 'selected' : ''}`} key={job.id}>
        <button className="job-main" disabled={busy || running} onClick={() => openJob(job)}><FileText size={16}/><span><b>{job.name}</b><small><i className={`status-dot ${job.status}`}/>{statusNames[job.status]} · {job.mode === 'personal' ? '个人' : '团队'}</small><small title={job.model}>{job.model || 'Workers AI'} · {new Date(job.created_at).toLocaleDateString('zh-CN')}</small></span></button>
        <Tip text="删除云端任务"><button className="icon-button job-delete" aria-label={`删除任务 ${job.name}`} disabled={busy || running} onClick={e => { deleteTrigger.current = e.currentTarget; setPendingDelete(job); }}><Trash2 size={14}/></button></Tip>
      </div>) : <div className="history-empty"><span className="empty-stack"><FileText size={18}/></span><p>下一场会议，从这里开始</p><small>AI 任务保留 7 天<br/>原表导入在当前浏览器完成</small></div>}</div>
      <div className="sidebar-note"><span className="note-dot"/><p>词条完整，译法准确。<br/><b>让每一场对话更顺畅。</b></p></div>
      <div className="sidebar-bottom"><span className="avatar">{user?.email?.[0]?.toUpperCase() || 'H'}</span><div><b>{user?.local ? '本地开发模式' : user?.role === 'admin' ? '团队管理员空间' : '团队成员空间'}</b><span>{user?.email ?? '正在验证登录…'}</span></div><ShieldCheck size={16}/></div>
    </aside>
    <main id="workspace">
      <header className="topbar"><span className="breadcrumb">工作台 <ChevronRight size={13}/> <b>{name || '新建词库'}</b></span><div className="top-actions"><span className="language-label"><Globe2 size={14}/> 中英双语</span><button className="button compact secondary" disabled={!reviewReady} onClick={saveProject}><Download size={14}/>保存项目</button></div></header>
      <div className="main-body">
        <div className="intro"><div><div className="eyebrow"><span/>BUILT FOR BETTER CONVERSATIONS</div><h1>好翻译，<br className="mobile-break"/>从<span className="headline-word">准确的词</span>开始。</h1><p>把会议资料整理成热词与指定翻译，<br className="mobile-break"/>从上传到导出，每一步都清晰可控。</p></div><button className="text-button example-button" disabled={busy || running} onClick={showExample}><span className="play-dot"><ArrowRight size={13}/></span>试试格式示例</button></div>
        <div className="flow-bar"><div className="steps" role="group" aria-label="工作流程">{([{ n: 1, label: '准备资料', detail: 'Upload' }, { n: 2, label: '审核词条', detail: 'Review' }, { n: 3, label: '导出词库', detail: 'Export' }] as const).map(step => <button key={step.n} className={`step ${stage === step.n ? 'current' : ''} ${stage > step.n ? 'complete' : ''}`} aria-current={stage === step.n ? 'step' : undefined} disabled={step.n !== 1 && !reviewReady} onClick={() => goTo(step.n)}>
          {stage === step.n && <motion.span layoutId="flow-indicator" className={`step-indicator stage-${stage}`}/>}<span className="step-number">{stage > step.n ? <Check size={13}/> : `0${step.n}`}</span><span className="step-label">{step.label}<small>{step.detail}</small></span>
        </button>)}</div><span className="flow-caption">完整词条 · 精准映射</span></div>
        <AnimatePresence initial={false}>{error && <motion.div className="alert error" role="alert" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}><span>{error}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setError('')}><X size={16}/></button></motion.div>}</AnimatePresence>
        {example && <div className="alert example-alert"><Sparkles size={16}/><span>正在体验格式示例。正式词库请使用实际会议资料。</span><button className="text-button" onClick={() => goTo(2)}>查看词条<ArrowDown size={14}/></button></div>}
        <section className="upload-section panel" ref={sections[1]}>
          <SectionTitle number="01" title="准备会议资料" detail="一次上传，开始整理" right={<span className="subtle-tag">单文件 ≤ 20 MB</span>}/>
          <div className="upload-grid">
            <button className={`dropzone ${dragging ? 'dragging' : ''} ${busy ? 'loading' : ''} ${parsed ? 'has-file' : ''}`} disabled={busy || running} onClick={() => input.current?.click()}
              onDragOver={e => { e.preventDefault(); if (!busy && !running) setDragging(true); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
              onDrop={e => { e.preventDefault(); setDragging(false); if (!busy && !running && e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); }}>
              <motion.div className="upload-art" animate={{ rotate: dragging ? -5 : 0, y: dragging ? -6 : 0 }}><span className="sheet sheet-back"/><span className="sheet sheet-mid"/><span className="sheet sheet-front">{busy ? <LoaderCircle size={25} className="spin"/> : parsed ? <FileCheck2 size={25}/> : <UploadCloud size={25}/>}<i/><i/></span>{parsed && <span className="file-ready"><Check size={11}/></span>}</motion.div>
              <strong>{busy ? '正在读取资料…' : dragging ? '松开，交给 HotWord' : parsed ? parsed.name : '拖入文件，或点击上传'}</strong><span>{parsed ? '点击更换会议资料' : 'PDF · Excel · Word · TXT · CSV'}</span><small>{parsed ? `${parsed.segments.length} 项内容已读取` : '读取后可选择页码与工作表'}</small>
            </button>
            <div className="upload-options"><label className="field-label" htmlFor="project-name">项目名称<span>方便下次找到它</span></label><input id="project-name" maxLength={100} value={name} onChange={e => setName(e.target.value)} placeholder="例如：国际复材 2026 年会议"/>
              <div className="rule-note"><ShieldCheck size={16}/><p>原文件在浏览器中读取。AI 仅提取所选内容；已有双语表，可直接导入。</p></div><FormatPlayground/>
            </div>
          </div>
          <ModelPanel settings={modelSettings} loading={modelsLoading} loadError={modelsError} selection={selection} onSelect={setSelection} open={modelOpen} onOpenChange={setModelOpen} refresh={refreshModels} admin={user?.role === 'admin'}/>
          {parsed && <div className="source-options">
            <div className="selection-heading"><div><b>选择参与提取的内容</b><span>{selected.length} 项 · <AnimatedNumber value={chars}/> 字符</span></div><button className="text-button" disabled={running} onClick={() => setSelected(selected.length ? [] : parsed.segments.filter(s => s.text.trim()).map(s => s.id))}>{selected.length ? '取消全选' : '全选'}</button></div>
            <div className="segment-list">{parsed.segments.map(segment => <label key={segment.id} className={selected.includes(segment.id) ? 'selected' : ''}><input type="checkbox" disabled={!segment.text.trim() || running} checked={selected.includes(segment.id)} onChange={e => setSelected(s => e.target.checked ? [...s, segment.id] : s.filter(id => id !== segment.id))}/><span>{segment.label}</span><small>{segment.text.length.toLocaleString()} 字</small></label>)}</div>
            <Disclosure title="查看所选原文" open={sourceOpen} onToggle={() => setSourceOpen(!sourceOpen)}><pre className="source-preview">{segments.map(s => `[${s.label}]\n${s.text}`).join('\n\n')}</pre></Disclosure>
            {tableMode && <div className="table-options"><div className="table-options-heading"><Layers3 size={17}/><strong>已有双语对照表</strong><span>沿用原表译法</span></div><div className="table-controls">
              <label>原词列<select value={sourceColumn} onChange={e => setSourceColumn(Number(e.target.value))}>{Array.from({ length: columns }, (_, i) => <option key={i} value={i}>{letter(i)} 列</option>)}</select></label><ArrowRight size={14}/>
              <label>译文列<select value={targetColumn} onChange={e => setTargetColumn(Number(e.target.value))}>{Array.from({ length: columns }, (_, i) => <option key={i} value={i}>{letter(i)} 列</option>)}</select></label>
              <Switch checked={skipHeader} onChange={setSkipHeader} label="跳过每表首行" disabled={running}/><button className="button primary" disabled={!segments.length || running} onClick={directImport}>按原表导入<ArrowRight size={15}/></button>
            </div><div className="table-sample">{segments.filter(s => s.rows).slice(0, 1).map(s => <div key={s.id}><small>前两行预览</small>{s.rows!.slice(0, 2).map((r, i) => <code key={i}>{r[sourceColumn] || '（空）'}<ArrowRight size={12}/>{r[targetColumn] || '（空）'}</code>)}</div>)}</div></div>}
            <div className="extract-action"><p>{chars > 120000 ? '超过 120000 字符，请减少页面 / 工作表或分批处理。' : '从资料中识别人名、地名、专名与关键行业术语。'}</p><button className="button primary" disabled={!user || !modelReady || busy || running || !name.trim() || !chars || chars > 120000} onClick={extract}><Sparkles size={16}/>{activeJob?.status === 'failed' ? '重新提取候选词' : 'AI 提取候选词'}<ArrowRight size={15}/></button></div>
          </div>}
        </section>
        {activeJob && <div className="task-model-note"><b>{activeJob.mode === 'personal' ? '个人服务' : '团队服务'} · {providerNames[activeJob.provider]} · {activeJob.model || 'Workers AI'}</b><span>{activeJob.input_tokens.toLocaleString()} 输入 / {activeJob.output_tokens.toLocaleString()} 输出 Token{activeJob.usage_estimated ? '（含估计用量）' : ''}{activeJob.estimated_usd === null ? '' : ` · 预估 $${activeJob.estimated_usd.toFixed(4)}`}</span>{activeJob.status === 'failed' && <button className="text-button" onClick={() => setModelOpen(true)}>重新配置 / 手动切换服务</button>}</div>}
        {running && <div className="progress-panel panel" role="status"><span className="progress-icon"><LoaderCircle size={22} className="spin"/></span><div><b>{statusNames[activeJob!.status]} · {activeJob!.name}</b><p>已完成 {activeJob!.progress} / {activeJob!.total || '…'} 个片段。可稍后从近期任务恢复。</p><progress value={activeJob!.progress} max={activeJob!.total || 1}/></div><button className="button secondary" disabled={deleting} onClick={e => { deleteTrigger.current = e.currentTarget; setPendingDelete(activeJob); }}>取消任务</button></div>}
        {warnings.length > 0 && <Disclosure className="warnings" title={`${warnings.length} 条读取 / 审核提示`} open={warningsOpen} onToggle={() => setWarningsOpen(!warningsOpen)}><ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></Disclosure>}
        {reviewReady && <>
          <section className="review-section panel" ref={sections[2]}>
            <SectionTitle number="02" title="审核与精简词条" detail="每一个译法，由你确认" right={<button className="button compact secondary" onClick={() => { setCandidates(c => [...c, { id: crypto.randomUUID(), source: '新词条', target: '', category: 'other', priority: 80, basis: 'manual', evidence: '', location: '手动添加', hot: true, translation: false, pinned: false }]); resetFilters(); setPage(Math.floor(candidates.length / 30)); }}><Plus size={15}/>添加词条</button>}/>
            <div className="review-summary"><div className="term-total"><strong><AnimatedNumber value={candidates.length}/></strong><span>候选词条</span></div><div className="mini-budget"><span><i/>热词清单</span><b><AnimatedNumber value={hot.chars}/><small> / 2,048</small></b></div><div className="mini-budget translation"><span><i/>指定翻译</span><b><AnimatedNumber value={translations.chars}/><small> / 20,480</small></b></div><button className="text-button" onClick={() => goTo(3)}>查看导出<ArrowDown size={14}/></button></div>
            <p className="review-description">勾选指定翻译即确认译法。拖动重要度调整取舍，勾选必保优先保留。人名、地名与机构优先纳入。</p>
            <div className="toolbar"><div className="search-field"><Search size={16}/><input aria-label="搜索词条" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索原词、译文或出处"/>{query && <button className="icon-button" aria-label="清空搜索" onClick={() => setQuery('')}><X size={13}/></button>}</div>
              <select aria-label="词条类别筛选" value={category} onChange={e => setCategory(e.target.value)}><option value="all">全部类别</option>{Object.entries(categoryNames).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <Segmented value={view} options={[{ value: 'all', label: '全部', count: candidates.length }, { value: 'review', label: '待审核', count: candidates.filter(needsReview).length }, { value: 'excluded', label: '未纳入', count: excludedIds.size }]} onChange={v => setView(v as typeof view)} label="审核视图"/>
            </div>
            <div className="table-scroll"><table><thead><tr><th className="check-column">热词</th><th className="check-column">指定翻译</th><th>原词</th><th>译文</th><th>类别</th><th>重要度</th><th className="check-column">必保</th><th>依据 / 出处</th><th><span className="sr-only">操作</span></th></tr></thead><tbody>{visible.slice(page * 30, page * 30 + 30).map(c => <tr key={c.id} className={excludedIds.has(c.id) ? 'excluded-row' : ''}>
              <td className="check-column"><Toggle label={`热词 ${c.source}`} checked={c.hot} onChange={v => update(c.id, { hot: v })}/></td>
              <td className="check-column"><Toggle label={`指定翻译 ${c.source}`} checked={c.translation} disabled={!c.target.trim()} onChange={v => update(c.id, { translation: v })}/></td>
              <td><input className="cell-input" aria-label={`原词 ${c.source}`} maxLength={180} value={c.source} onChange={e => update(c.id, { source: e.target.value, basis: 'manual' })}/></td>
              <td><input className="cell-input target-input" aria-label={`译文 ${c.source}`} maxLength={180} value={c.target} onChange={e => update(c.id, { target: e.target.value, basis: 'manual', translation: false })} placeholder="未确认译名，留空"/>{c.basis === 'suggested' && <span className="suggestion-tag">AI 建议 · 待确认</span>}</td>
              <td><select aria-label={`类别 ${c.source}`} value={c.category} onChange={e => update(c.id, { category: e.target.value as Category })}>{Object.entries(categoryNames).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
              <td><PrioritySlider label={`重要度 ${c.source}`} value={c.priority} onChange={v => update(c.id, { priority: v })}/></td>
              <td className="check-column"><Toggle label={`必保 ${c.source}`} checked={c.pinned} pinned onChange={v => update(c.id, { pinned: v })}/></td>
              <td className="evidence"><details><summary>{c.location || '手动'}{c.basis === 'source' && <Check size={12}/>}</summary><p>{c.evidence || '手动录入'}</p></details>{excluded.filter(e => e.id === c.id).map((e, i) => <small key={i}>{e.reason}</small>)}</td>
              <td><Tip text="移除词条，可撤销"><button className="icon-button row-delete" aria-label={`删除词条 ${c.source}`} onClick={() => removeTerm(c)}><X size={14}/></button></Tip></td>
            </tr>)}</tbody></table>{!visible.length && <div className="no-results"><Search size={22}/><b>{candidates.length ? '没有匹配的词条' : '词库还是空的'}</b><p>{candidates.length ? '试试其他关键词，或切换审核视图。' : '可以添加词条，或重新导入资料。'}</p>{candidates.length > 0 && <button className="text-button" onClick={resetFilters}>重置筛选<RefreshCw size={13}/></button>}</div>}</div>
            <div className="review-footer"><span>{visible.length} 条结果<span className="footer-divider">·</span>按完整条目取舍，保留原文依据</span><div className="pagination"><button className="icon-button" aria-label="上一页" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft size={16}/></button><span>{pages ? page + 1 : 0} / {pages}</span><button className="icon-button" aria-label="下一页" disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)}><ChevronRight size={16}/></button></div></div>
          </section>
          <section className="export-section" ref={sections[3]}><SectionTitle number="03" title="带走你的会议词库" detail="两份 TXT，已按导入规则整理" right={<Switch checked={bidirectional} onChange={setBidirectional} label="生成双向映射"/>}/>
            <div className="export-grid"><ExportCard kind="hot" title="热词清单" description="中英文完整词条 · 中文逗号分隔" compiled={hot} limit={2048} onDownload={() => exportTxt('hot', hot)} onCopy={() => exportTxt('hot', hot, true)}/><ExportCard kind="translation" title="指定翻译" description="原词-译文 · 中文逗号分隔完整映射" compiled={translations} limit={20480} onDownload={() => exportTxt('translation', translations)} onCopy={() => exportTxt('translation', translations, true)}/></div>
            <div className="save-review"><p><ShieldCheck size={14}/>字符数包含 BOM 与 Windows 换行；超限时按完整条目取舍。</p><button className="text-button" onClick={saveProject}>保存审核项目<ArrowRight size={14}/></button></div>
          </section>
        </>}
        {!reviewReady && !parsed && <div className="getting-started"><div><span className="feature-icon peach"><FileText size={17}/></span><h3>词组，完整保留</h3><p>英文短语不拆词，中文词组不拆字。</p></div><div><span className="feature-icon lilac"><ShieldCheck size={17}/></span><h3>格式与字数，刚刚好</h3><p>热词 2,048 · 指定翻译 20,480 字符。</p></div><div><span className="feature-icon mint"><Sparkles size={17}/></span><h3>聚焦容易译错的词</h3><p>人名、地名、专名与重要行业术语。</p></div></div>}
        <footer><span>HotWord<span className="footer-divider">/</span>每一个词，都值得准确。</span><span>为下一场好对话做好准备<ArrowRight size={12}/></span></footer>
      </div>
    </main>
    <input ref={input} hidden type="file" accept=".pdf,.xlsx,.docx,.txt,.csv" onChange={e => { if (e.target.files?.[0]) readFile(e.target.files[0]); e.target.value = ''; }}/>
    <input ref={projectInput} hidden type="file" accept=".json" onChange={e => { if (e.target.files?.[0]) importProject(e.target.files[0]); e.target.value = ''; }}/>
    <ConfirmDialog open={!!pendingDelete} onClose={() => setPendingDelete(undefined)} onConfirm={deleteJob} busy={deleting} title="删除这个云端任务？" returnFocus={() => deleteTrigger.current?.isConnected ? deleteTrigger.current.focus() : document.querySelector<HTMLButtonElement>('[aria-label="刷新任务"]')?.focus()}>{pendingDelete?.name} 的任务记录及云端文件将被删除。已下载到本地的文件仍可使用。</ConfirmDialog>
    <AnimatePresence>{toast && <motion.div key={toast.id} className="toast" role="status" initial={{ opacity: 0, y: 24, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.96 }}><span className="toast-check"><Check size={14}/></span><span>{toast.message}</span>{toast.action && <button onClick={toast.action}>撤销</button>}<button className="toast-close" aria-label="关闭操作提示" onClick={() => setToast(undefined)}><X size={14}/></button></motion.div>}</AnimatePresence>
  </div></Tooltip.Provider></MotionConfig>;
}
function SectionTitle({ number, title, detail, right }: { number: string; title: string; detail: string; right: ReactNode }) {
  return <div className="section-title"><div><span className="section-number">{number}</span><div><h2>{title}</h2><p>{detail}</p></div></div>{right}</div>;
}
function FormatPlayground() {
  const [reversed, setReversed] = useState(false);
  return <div className="format-playground"><div className="format-label"><span>指定翻译，长这样</span><Tip text="交换原词与译文，体验完整映射"><motion.button className="icon-button" aria-label="交换格式示例方向" onClick={() => setReversed(!reversed)} whileTap={{ rotate: 180 }}><ArrowLeftRight size={13}/></motion.button></Tip></div><div className="format-pair"><motion.span layout className={reversed ? 'chinese' : ''} key={reversed ? 'cn' : 'en'}>{reversed ? '产业协同' : 'Industrial Collaboration'}</motion.span><span className="mapping-dash">-</span><motion.span layout className={reversed ? '' : 'chinese'} key={reversed ? 'en' : 'cn'}>{reversed ? 'Industrial Collaboration' : '产业协同'}</motion.span><span className="mapping-comma">，</span></div><p><Check size={12}/>完整词组 · 一个连接符 · 逗号分隔条目</p></div>;
}
function ExportCard({ kind, title, description, compiled, limit, onDownload, onCopy }: { kind: string; title: string; description: string; compiled: Compiled; limit: number; onDownload: () => void; onCopy: () => void }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const valid = !compiled.errors.length;
  return <div className={`export-card panel ${kind}`}>
    <div className="export-card-top"><span className="file-icon"><FileText size={21}/><small>TXT</small></span><div><h3>{title}</h3><p>{description}</p></div><span className={`format-badge ${valid ? '' : 'invalid'}`}>{valid ? <Check size={11}/> : <X size={11}/>}<span>{valid ? '格式已校验' : '需要调整'}</span></span></div>
    <div className="character-count"><strong><AnimatedNumber value={compiled.chars}/></strong><span>/ {limit.toLocaleString()} 字符</span><small>{compiled.count} 条完整{kind === 'hot' ? '词条' : '映射'}</small></div>
    <div className="budget-bar" role="meter" aria-label={`${title}字符预算`} aria-valuenow={compiled.chars} aria-valuemin={0} aria-valuemax={limit}><motion.span animate={{ width: `${Math.min(100, compiled.chars / limit * 100)}%` }}/></div>
    <div className="preview-heading"><span>TXT 预览</span><Tip text="复制已校验的完整内容"><button className="icon-button" disabled={!compiled.count || !valid} aria-label={`复制${title}`} onClick={onCopy}><Copy size={14}/></button></Tip></div>
    <pre className="output-preview" tabIndex={0} aria-label={`${title}内容预览`}>{compiled.content || '选择词条后，在这里预览完整内容。'}</pre>
    {compiled.errors.map(e => <p className="error-text" role="alert" key={e}>{e}</p>)}
    <Disclosure className="export-details" title={<span>未纳入 <b>{compiled.excluded.length}</b> 条<span className="footer-divider">·</span>格式调整 <b>{compiled.changes.length}</b> 处</span>} open={detailsOpen} onToggle={() => setDetailsOpen(!detailsOpen)}>{compiled.excluded.length + compiled.changes.length ? <ul>{compiled.excluded.map((e, i) => <li key={i}>{e.term}：{e.reason}</li>)}{compiled.changes.map((c, i) => <li key={`change-${i}`}>{c}</li>)}</ul> : <p className="all-clear"><Check size={13}/>所有已选条目均完整纳入，无需格式调整。</p>}</Disclosure>
    <motion.button className="button primary download-button" disabled={!compiled.count || !valid} onClick={onDownload} whileTap={{ scale: 0.985 }}><Download size={16}/>下载{title}.txt<ArrowRight size={15}/></motion.button>
  </div>;
}

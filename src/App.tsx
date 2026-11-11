import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { ArrowLeft, ArrowLeftRight, ArrowRight, Check, ChevronLeft, ChevronRight, CircleHelp, Clock3, Copy, Download, Ellipsis, FileCheck2, FileText, FolderOpen, Globe2, Layers3, LoaderCircle, Plus, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Trash2, UploadCloud, X } from 'lucide-react';
import { api } from './api';
import { CandidateSchema, categoryNames, type Candidate, type Category, type ExtractionResult, type Job, type ParsedFile } from '../shared/schema';
import { compileHotwords, compileTranslations, fileText, validateExport, type Compiled } from '../shared/compiler';
import { detectTableColumns, importTable, recommendTableImport } from '../shared/table-import';
import { termIssue } from '../shared/term-quality';
import { AnimatedNumber, ConfirmDialog, Disclosure, OverlayPanel, PrioritySlider, Segmented, Switch, Tip, Toggle, spring } from './components/ui';
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
  const [automaticColumns, setAutomaticColumns] = useState(false), [tableNote, setTableNote] = useState('');
  const [skipHeader, setSkipHeader] = useState(true), [bidirectional, setBidirectional] = useState(false);
  const [query, setQuery] = useState(''), [category, setCategory] = useState('all');
  const [view, setView] = useState<'all' | 'review' | 'excluded'>('all');
  const [page, setPage] = useState(0), [example, setExample] = useState(false);
  const [stage, setStage] = useState<Stage>(1), [reviewReady, setReviewReady] = useState(false);
  const [dragging, setDragging] = useState(false), [sourceOpen, setSourceOpen] = useState(false), [warningsOpen, setWarningsOpen] = useState(false);
  const [toast, setToast] = useState<Toast>();
  const [historyOpen, setHistoryOpen] = useState(false), [helpOpen, setHelpOpen] = useState(false);
  const [historyError, setHistoryError] = useState(''), [historyLoading, setHistoryLoading] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false), [processing, setProcessing] = useState('ai');
  const [editingTerm, setEditingTerm] = useState<string>();
  const [pendingDelete, setPendingDelete] = useState<Job>(), [deleting, setDeleting] = useState(false);
  const input = useRef<HTMLInputElement>(null), projectInput = useRef<HTMLInputElement>(null);
  const parseWorker = useRef<Worker | null>(null);
  const stageFocus = useRef<HTMLHeadingElement>(null);
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
  const reduced = useReducedMotion();
  const segments = useMemo(() => parsed?.segments.filter(s => selected.includes(s.id)) ?? [], [parsed, selected]);
  const chars = segments.reduce((n, s) => n + s.text.length, 0);
  const tableMode = !!parsed?.segments.some(s => s.rows);
  const directMode = processing === 'table' && tableMode;
  const tableMappings = segments.filter(s => s.rows).map(segment => {
    const detected = automaticColumns ? detectTableColumns(segment) : undefined;
    return { segment, sourceIndex: detected?.sourceColumn ?? sourceColumn, targetIndex: detected?.targetColumn ?? targetColumn, headerRow: detected?.headerRow ?? 0 };
  });
  const columns = Math.max(2, ...(parsed?.segments ?? []).flatMap(s => s.rows?.slice(0, 10).map(r => r.length) ?? []));
  const hot = useMemo(() => compileHotwords(candidates), [candidates]);
  const translations = useMemo(() => compileTranslations(candidates, bidirectional), [candidates, bidirectional]);
  const excluded = [...hot.excluded, ...translations.excluded];
  const excludedIds = new Set(excluded.map(e => e.id));
  const junkCount = candidates.filter(c => termIssue(c.source) || (c.target && termIssue(c.target))).length;
  const needsReview = (c: Candidate) => (c.basis === 'suggested' && !c.translation) || /[/／]/.test(c.source + c.target);
  const edited = candidates.find(c => c.id === editingTerm);
  const pendingCount = candidates.filter(c => c.target.trim() && !c.translation && c.hot).length;
  const selectedModel = selection?.mode === 'team' ? modelSettings?.services.find(s => s.id === selection.serviceId)?.name : modelSettings?.credentials.find(c => c.id === selection?.credentialId)?.name;
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
  function goTo(next: Stage) { setStage(next); setEditingTerm(undefined); }
  useEffect(() => {
    if (stage === 1 && !reviewReady && !parsed) return;
    const timer = window.setTimeout(() => {
      stageFocus.current?.focus({ preventScroll: true });
      const workflow = document.getElementById('workflow');
      const top = workflow?.getBoundingClientRect().top;
      if (top !== undefined && (top < 16 || top > window.innerHeight * .65)) workflow?.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'start' });
    }, reduced ? 0 : 220);
    return () => window.clearTimeout(timer);
  }, [stage, reduced]);
  function ready(terms: Candidate[], nextWarnings: string[]) {
    setCandidates(terms); setWarnings(nextWarnings); setReviewReady(true); setStage(2); setExample(false); setToast(undefined); resetFilters();
  }
  async function refreshJobs() {
    setHistoryLoading(true); setHistoryError('');
    try { setJobs(await api<Job[]>('/api/jobs')); }
    catch (e) { setHistoryError((e as Error).message); throw e; }
    finally { setHistoryLoading(false); }
  }
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
    refreshModels().catch(() => {});
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
      setParsed(result);
      const recommendation = result.segments.some(s => s.rows) ? recommendTableImport(result.segments) : undefined;
      setSelected(recommendation?.selected ?? result.segments.filter(s => s.text.trim()).map(s => s.id));
      setAutomaticColumns(recommendation?.automatic ?? false); setTableNote(recommendation?.note ?? '');
      setSourceColumn(recommendation?.sourceColumn ?? 0); setTargetColumn(recommendation?.targetColumn ?? 1); setSkipHeader(recommendation?.skipHeader ?? true);
      setProcessing(result.segments.some(s => s.rows) ? 'table' : 'ai'); setRangeOpen(false);
      setName(file.name.replace(/\.[^.]+$/, '').slice(0, 100)); setWarnings(result.warnings);
      setCandidates([]); setActiveJob(undefined); setExample(false); setReviewReady(false); setSourceOpen(false); resetFilters();
      notify(`已读取 ${result.segments.length} 项内容`);
    };
    worker.onerror = () => { window.clearTimeout(timeout); worker.terminate(); setBusy(false); setError('文件读取失败，请检查格式或改用 TXT'); };
    worker.postMessage(file);
  }
  function directImport() {
    setError('');
    if (!automaticColumns && sourceColumn === targetColumn) { setError('原词列和译文列不能相同'); return; }
    const result = importTable(segments, sourceColumn, targetColumn, skipHeader, automaticColumns);
    if (!result.candidates.length) { setError('所选列中没有有效术语，请核对原词列与译文列；序号、说明和占位内容不会导入。'); return; }
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
    setHistoryOpen(false);
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
      if (result.version !== 1 || !Array.isArray(result.candidates) || result.candidates.length > 20000 || typeof result.name !== 'string') throw new Error('不是有效的 HotWord 审核项目');
      const terms = result.candidates.map((c: unknown) => CandidateSchema.parse(c));
      if (new Set(terms.map((c: Candidate) => c.id)).size !== terms.length) throw new Error('项目内存在重复词条 ID');
      ready(terms, []); setName(result.name.slice(0, 100)); setParsed(undefined); setSelected([]); setActiveJob(undefined); setError(''); notify('审核项目已恢复');
    } catch { setError('项目文件无效，请导入由本工具保存的 JSON 审核项目'); }
  }
  function showExample() { ready(demo, []); setName('格式示例'); setParsed(undefined); setSelected([]); setActiveJob(undefined); setExample(true); setError(''); }

  return <MotionConfig reducedMotion="user" transition={reduced ? { duration: 0 } : spring}><Tooltip.Provider delayDuration={350}>
    <div className={`layout stage-${stage}`}>
      <header className="app-header">
        <a className="brand" href="#workspace" onClick={() => goTo(1)} aria-label="HotWord 工作台"><span className="brand-mark"><Layers3 size={21}/></span><strong>HotWord<span>让对话，少一点误解。</span></strong></a>
        <nav className="header-nav" aria-label="工作台导航"><span className="header-current">会议词库</span><button onClick={() => setHistoryOpen(true)}><Clock3 size={15}/>近期任务{jobs.length > 0 && <small>{jobs.length}</small>}</button></nav>
        <div className="header-actions"><Tip text="继续编辑已保存的 JSON 项目"><button className="icon-button" aria-label="导入审核项目" disabled={busy || running} onClick={() => projectInput.current?.click()}><FolderOpen size={18}/></button></Tip><Tip text="模型与密钥"><button className="icon-button" aria-label="模型与密钥" onClick={() => setModelOpen(true)}><Settings2 size={18}/></button></Tip><Tip text="使用指南"><button className="icon-button" aria-label="使用指南" onClick={() => setHelpOpen(true)}><CircleHelp size={18}/></button></Tip><span className="header-divider"/><Tip text={user?.email || '正在验证登录'}><span className="avatar" aria-label={user?.local ? '本地开发模式' : '团队成员'}>{user?.email?.[0]?.toUpperCase() || 'H'}</span></Tip></div>
      </header>
      <main id="workspace">
        {stage === 1 && <div className={`intro ${parsed || reviewReady || running ? 'intro-compact' : ''}`}>
          <div className="eyebrow"><span/>A LITTLE PREPARATION. A BETTER CONVERSATION.</div>
          <h1>好翻译，从<span className="headline-word">准确的词</span>开始。</h1>
          <p>上传会议资料，整理专属词库。三步，轻松带走。</p>
        </div>}
        <div id="workflow" className="flow-bar"><nav className="steps" aria-label="工作流程">{([{ n: 1, label: '准备资料', icon: UploadCloud }, { n: 2, label: '核对词条', icon: FileCheck2 }, { n: 3, label: '下载词库', icon: Download }] as const).map(step => <button key={step.n} className={`step ${stage === step.n ? 'current' : ''}`} aria-current={stage === step.n ? 'step' : undefined} disabled={step.n !== 1 && (!reviewReady || busy || running)} onClick={() => goTo(step.n)}>
          {stage === step.n && <motion.span layoutId="flow-indicator" className={`step-indicator tone-${stage}`}/>}<span className="step-number">{reviewReady && step.n === 1 ? <Check size={12}/> : `0${step.n}`}</span><span>{step.label}</span>{stage === step.n && <step.icon size={14} className="step-icon"/>}
        </button>)}</nav></div>
        <div className="main-body">
          <AnimatePresence initial={false}>{error && <motion.div className="alert error" role="alert" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><span>{error}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setError('')}><X size={16}/></button></motion.div>}</AnimatePresence>
          {example && <div className="example-alert"><span className="example-dot"/>示例体验 · 这些词条仅用于演示<button className="text-button" onClick={() => { goTo(1); input.current?.click(); }}>上传自己的资料<ArrowRight size={13}/></button></div>}
          <AnimatePresence mode="wait" initial={false}><motion.div key={stage} className="stage-content" initial={{ opacity: 0, y: reduced ? 0 : 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : -6 }} transition={{ duration: reduced ? 0 : .18, ease: 'easeOut' }}>
            {stage === 1 && <section className={`upload-section panel ${parsed ? 'file-loaded' : ''}`} aria-label="准备资料">
              {!parsed && !running && <>
                <div className="upload-heading"><span className="small-kicker">从一份资料开始</span><h2 ref={stageFocus} tabIndex={-1}>把会议资料，放在这里。</h2><p>已有双语表直接导入，其他资料交给 AI 整理。</p></div>
                <button className={`dropzone ${dragging ? 'dragging' : ''} ${busy ? 'loading' : ''}`} aria-label="上传会议资料" disabled={busy || running} onClick={() => input.current?.click()}
                  onDragOver={e => { e.preventDefault(); if (!busy && !running) setDragging(true); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
                  onDrop={e => { e.preventDefault(); setDragging(false); if (!busy && !running && e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); }}>
                  <motion.div className="upload-art" animate={{ rotate: dragging ? -4 : 0, y: dragging ? -8 : 0 }} aria-hidden="true"><span className="art-orbit"/><span className="sheet sheet-back"><i/><i/><i/></span><span className="sheet sheet-mid"><b>Aa</b><i/><i/></span><span className="sheet sheet-front">{busy ? <LoaderCircle size={25} className="spin"/> : <UploadCloud size={25}/>}<i/><i/><small>YOUR NEXT CONVERSATION</small></span><span className="art-spark"><Sparkles size={14}/></span><span className="art-word">词<span>word</span></span></motion.div>
                  <strong>{busy ? '正在读取，请稍等片刻…' : dragging ? '松开，开始整理' : '拖入文件，或点击选择'}</strong><span>{busy ? '正在读取文档中的文字内容' : 'PDF、Excel、Word、TXT 或 CSV · 最大 20 MB'}</span><span className="upload-cta">{busy ? '读取中' : '选择会议资料'}{!busy && <Plus size={16}/>}</span>
                </button>
                <div className="upload-bottom"><span><ShieldCheck size={13}/>原文件在浏览器中读取</span><button className="text-button" onClick={() => setHelpOpen(true)}>支持哪些资料？<ArrowRight size={12}/></button></div>
              </>}
              {parsed && !running && <>
                <div className="section-title"><div><span className="small-kicker">资料已就绪</span><h2 ref={stageFocus} tabIndex={-1}>接下来，选择整理方式。</h2></div><span className="ready-badge"><Check size={12}/>已读取</span></div>
                <div className="uploaded-file"><span className="uploaded-icon"><FileText size={23}/></span><div><strong>{parsed.name}</strong><small>{parsed.segments.length} 项内容 · {chars.toLocaleString()} 字已选</small></div><button className="text-button" disabled={busy || running} onClick={() => input.current?.click()}>更换资料<RefreshCw size={13}/></button></div>
                <div className="project-name-field"><label htmlFor="project-name">词库名称</label><input id="project-name" maxLength={100} value={name} onChange={e => setName(e.target.value)} placeholder="为这场会议起个名字"/></div>
                <Disclosure className="range-options" title={<span>选择页码或工作表<small>{selected.length} / {parsed.segments.length} 项</small></span>} open={rangeOpen} onToggle={() => setRangeOpen(!rangeOpen)}>
                  <div className="selection-heading"><span>仅处理勾选的内容</span><button className="text-button" onClick={() => setSelected(selected.length ? [] : parsed.segments.filter(s => s.text.trim()).map(s => s.id))}>{selected.length ? '取消全选' : '全选'}</button></div>
                  <div className="segment-list">{parsed.segments.map(segment => <label key={segment.id} className={selected.includes(segment.id) ? 'selected' : ''}><input type="checkbox" disabled={!segment.text.trim() || running} checked={selected.includes(segment.id)} onChange={e => setSelected(s => e.target.checked ? [...s, segment.id] : s.filter(id => id !== segment.id))}/><span>{segment.label}</span><small>{segment.text.length.toLocaleString()} 字</small></label>)}</div>
                  <Disclosure title="查看所选原文" open={sourceOpen} onToggle={() => setSourceOpen(!sourceOpen)}><pre className="source-preview">{segments.map(s => `[${s.label}]\n${s.text}`).join('\n\n')}</pre></Disclosure>
                </Disclosure>
                <div className="processing-area">{tableMode ? <Segmented value={processing} label="资料整理方式" options={[{ value: 'table', label: '沿用原表译法' }, { value: 'ai', label: 'AI 提取词条' }]} onChange={setProcessing}/> : <span className="processing-label"><Sparkles size={16}/>AI 提取词条</span>}
                  {directMode ? <div className="table-options"><p>{tableNote}</p><div className="table-controls"><Switch checked={automaticColumns} onChange={setAutomaticColumns} label="自动识别术语列"/><Switch checked={skipHeader} onChange={setSkipHeader} label="跳过表头"/>{!automaticColumns && <><label>原词列<select aria-label="原词列" value={sourceColumn} onChange={e => setSourceColumn(Number(e.target.value))}>{Array.from({ length: columns }, (_, i) => <option key={i} value={i}>{letter(i)} 列</option>)}</select></label><ArrowRight size={16}/><label>译文列<select aria-label="译文列" value={targetColumn} onChange={e => setTargetColumn(Number(e.target.value))}>{Array.from({ length: columns }, (_, i) => <option key={i} value={i}>{letter(i)} 列</option>)}</select></label></>}</div>{automaticColumns && <div className="table-column-map">{tableMappings.map(m => <span key={m.segment.id}>{m.segment.label}<b>{letter(m.sourceIndex)} 列原词<ArrowRight size={11}/>{letter(m.targetIndex)} 列译文</b></span>)}</div>}<div className="table-sample">{tableMappings.slice(0, 1).map(m => <div key={m.segment.id}><small>词条预览</small>{m.segment.rows!.slice(skipHeader ? m.headerRow + 1 : 0, (skipHeader ? m.headerRow + 1 : 0) + 2).map((r, i) => <div className="sample-pair" key={i}><span>{r[m.sourceIndex] || '（空）'}</span><ArrowRight size={12}/><span>{r[m.targetIndex] || '（空）'}</span></div>)}</div>)}</div></div> : <div className="ai-choice"><p>识别人名、地名、机构和行业术语，生成候选译法。</p><button className={`model-summary ${!modelReady ? 'unready' : ''}`} onClick={() => setModelOpen(true)}><span className="model-summary-icon"><Sparkles size={15}/></span><span><b>{modelsLoading ? '正在读取 AI 配置…' : selectedModel || '选择 AI 服务'}</b><small>{modelsError ? '打开设置，重新读取配置' : modelReady ? '当前服务已就绪' : '设置完成后即可开始'}</small></span><Settings2 size={16}/></button></div>}
                </div>
                <div className="stage-actions"><span>{!chars ? '请先选择至少一项有文字的内容' : directMode ? '直接导入，无需调用 AI' : chars > 120000 ? '内容超过 120,000 字，请减少所选范围' : !name.trim() ? '请填写词库名称' : !user ? '正在验证登录状态' : !modelReady ? '请先选择可用的 AI 服务' : '提取完成后，进入人工核对'}{chars > 120000 && !directMode && <button className="text-button" onClick={() => setRangeOpen(true)}>选择范围</button>}</span><motion.button className="button primary" whileTap={{ scale: .98 }} disabled={busy || running || !chars || (!directMode && (!user || !modelReady || !name.trim() || chars > 120000))} onClick={directMode ? directImport : extract}>{busy ? <LoaderCircle className="spin" size={16}/> : directMode ? <FileCheck2 size={16}/> : <Sparkles size={16}/>}<span>{directMode ? '导入并核对' : '开始提取'}</span><ArrowRight size={16}/></motion.button></div>
              </>}
              {running && <div className="processing-state" role="status"><span className="processing-orb"><LoaderCircle size={30} className="spin"/></span><span className="small-kicker">正在为这场对话做准备</span><h2 ref={stageFocus} tabIndex={-1}>{statusNames[activeJob!.status]} · {activeJob!.name}</h2><p>已完成 {activeJob!.progress} / {activeJob!.total || '…'} 个片段</p><progress value={activeJob!.progress} max={activeJob!.total || 1}/><small>可以关闭页面，稍后从近期任务继续。</small><button className="text-button" disabled={deleting} onClick={e => { deleteTrigger.current = e.currentTarget; setPendingDelete(activeJob); }}>取消任务</button></div>}
            </section>}
            {stage === 2 && reviewReady && <section className="review-section" aria-label="核对词条">
              <div className="section-title"><div><span className="small-kicker">{name || '会议词库'}</span><h2 ref={stageFocus} tabIndex={-1}>核对一下，译法就统一了。</h2></div><button className="button compact secondary" onClick={() => { const id = crypto.randomUUID(); setCandidates(c => [...c, { id, source: '新词条', target: '', category: 'other', priority: 80, basis: 'manual', evidence: '', location: '手动添加', hot: true, translation: false, pinned: false }]); resetFilters(); setPage(Math.floor(candidates.length / 30)); setEditingTerm(id); }}><Plus size={15}/>添加词条</button></div>
              <div className="review-summary"><span><b><AnimatedNumber value={candidates.length}/></b> 个词条</span><span><i className="status-dot completed"/><b>{candidates.filter(c => c.translation).length}</b> 个译法已确认</span><button className="budget-peek" onClick={() => goTo(3)}><span>热词 <b><AnimatedNumber value={hot.chars}/></b> / 2,048</span><ChevronRight size={13}/></button></div>
              <div className="review-workspace panel"><div className="toolbar"><Segmented value={view} options={[{ value: 'all', label: '全部词条', count: candidates.length }, { value: 'review', label: '待审核', count: candidates.filter(needsReview).length }, { value: 'excluded', label: '未纳入', count: excludedIds.size }]} onChange={v => setView(v as typeof view)} label="审核视图"/><div className="search-field"><Search size={15}/><input aria-label="搜索词条" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索词条"/>{query && <button className="icon-button" aria-label="清空搜索" onClick={() => setQuery('')}><X size={13}/></button>}</div><select aria-label="词条类别筛选" value={category} onChange={e => setCategory(e.target.value)}><option value="all">全部类别</option>{Object.entries(categoryNames).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                <div className="term-head" aria-hidden="true"><span>#</span><span>原词</span><span>译文</span><span>纳入词库</span><span/></div>
                <div className="term-list">{visible.slice(page * 30, page * 30 + 30).map((c, i) => <div key={c.id} className={`term-row ${excludedIds.has(c.id) ? 'excluded-row' : ''}`}>
                  <span className="term-index">{String(page * 30 + i + 1).padStart(2, '0')}</span><div className="term-source"><label className="mobile-cell-label" htmlFor={`source-${c.id}`}>原词</label><textarea rows={1} id={`source-${c.id}`} className="cell-input" aria-label={`原词 ${c.source}`} maxLength={180} value={c.source} onChange={e => update(c.id, { source: e.target.value, basis: 'manual' })}/><span className="category-chip">{categoryNames[c.category]}{c.pinned && <span className="pin-label"> · 必保</span>}</span></div>
                  <div className="term-target"><label className="mobile-cell-label" htmlFor={`target-${c.id}`}>译文</label><textarea rows={1} id={`target-${c.id}`} className="cell-input target-input" aria-label={`译文 ${c.source}`} maxLength={180} value={c.target} onChange={e => update(c.id, { target: e.target.value, basis: 'manual', translation: false })} placeholder="填写译文"/><span className={`term-status ${c.translation ? 'confirmed' : ''}`}>{c.translation ? <><Check size={10}/>译法已确认</> : c.target.trim() ? '译法待确认' : '暂未填写译文'}</span></div>
                  <div className="term-toggles"><Toggle label={`热词 ${c.source}`} text="热词" checked={c.hot} onChange={v => update(c.id, { hot: v })}/><Toggle label={`指定翻译 ${c.source}`} text="指定翻译" checked={c.translation} disabled={!c.target.trim()} onChange={v => update(c.id, { translation: v })}/></div>
                  <Tip text="查看原文与高级选项"><button className="icon-button term-detail" aria-label={`词条详情 ${c.source}`} onClick={() => setEditingTerm(c.id)}><Ellipsis size={19}/></button></Tip>
                </div>)}</div>
                {!visible.length && <div className="no-results"><span className="empty-icon">{view === 'review' ? <Check size={23}/> : <Search size={23}/>}</span><b>{!candidates.length ? '从第一个词条开始' : view === 'review' && !query && category === 'all' ? '没有待审核的建议译法' : '没有匹配的词条'}</b><p>{!candidates.length ? '点击“添加词条”，或返回上传资料。' : '可以切换视图，继续检查其他词条。'}</p>{candidates.length > 0 && <button className="text-button" onClick={resetFilters}>查看全部词条<ArrowRight size={13}/></button>}</div>}
                <div className="review-footer"><span>{visible.length} 条结果</span><div className="pagination"><button className="icon-button" aria-label="上一页" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft size={16}/></button><span>{pages ? page + 1 : 0} / {pages}</span><button className="icon-button" aria-label="下一页" disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)}><ChevronRight size={16}/></button></div></div>
              </div>
              <div className="stage-actions floating-actions"><button className="text-button" onClick={() => goTo(1)}><ArrowLeft size={14}/>返回资料</button><span className="action-hint">{pendingCount ? `${pendingCount} 个译法待确认，确认后才会导出` : '勾选“指定翻译”，即可确认译法'}</span><motion.button className="button primary" disabled={!candidates.length} onClick={() => goTo(3)} whileTap={{ scale: .98 }}>预览并导出<ArrowRight size={16}/></motion.button></div>
            </section>}
            {stage === 3 && reviewReady && <section className="export-section" aria-label="下载词库"><div className="section-title"><div><span className="small-kicker">{name || '会议词库'}</span><h2 ref={stageFocus} tabIndex={-1}>{hot.errors.length || translations.errors.length ? '再调整一下，就可以带走。' : '你的会议词库，准备好了。'}</h2></div><Switch checked={bidirectional} onChange={setBidirectional} label="生成双向映射"/></div>
              {junkCount > 0 && <div className="export-notice"><ShieldCheck size={15}/><span>已隔离 {junkCount} 个含编号、说明或占位内容的词条。</span><button className="text-button" onClick={() => { setView('excluded'); goTo(2); }}>查看未纳入项<ArrowLeft size={12}/></button></div>}
              {pendingCount > 0 && <div className="export-notice"><CircleHelp size={15}/><span>{pendingCount} 个尚未确认的译法不会导出。</span><button className="text-button" onClick={() => goTo(2)}>返回核对<ArrowLeft size={12}/></button></div>}
              <div className="export-grid"><ExportCard kind="hot" title="热词清单" description="帮助翻译工具准确识别专有名词" compiled={hot} limit={2048} onDownload={() => exportTxt('hot', hot)} onCopy={() => exportTxt('hot', hot, true)}/><ExportCard kind="translation" title="指定翻译" description="让同一个词，始终使用同一种译法" compiled={translations} limit={20480} onDownload={() => exportTxt('translation', translations)} onCopy={() => exportTxt('translation', translations, true)}/></div>
              <div className="save-review"><span><ShieldCheck size={14}/>已按导入格式整理，保留完整词组。</span><button className="text-button" onClick={() => setHelpOpen(true)}>查看格式规则<ArrowRight size={12}/></button></div>
              <div className="stage-actions"><button className="text-button" onClick={() => goTo(2)}><ArrowLeft size={14}/>继续核对</button><span className="action-hint">保存审核项目，下次还能接着编辑。</span><button className="button secondary" onClick={saveProject}><FolderOpen size={16}/>保存审核项目</button></div>
            </section>}
          </motion.div></AnimatePresence>
          {warnings.length > 0 && <Disclosure className="warnings" title={`${warnings.length} 条资料 / 审核提示`} open={warningsOpen} onToggle={() => setWarningsOpen(!warningsOpen)}><ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></Disclosure>}
          {stage === 1 && !parsed && !running && <div className="start-shortcuts"><button className="text-button" disabled={busy} onClick={showExample}><span className="play-dot"><ArrowRight size={12}/></span>先试试一个小示例</button><span className="shortcut-divider"/><button className="text-button" disabled={busy} onClick={() => projectInput.current?.click()}><FolderOpen size={14}/>继续已有项目</button></div>}
          <footer><span>少一点误解，多一点默契。</span><span className="footer-language"><Globe2 size={12}/>中英双语<span className="footer-divider">·</span>HotWord</span></footer>
        </div>
      </main>
      <ModelPanel settings={modelSettings} loading={modelsLoading} loadError={modelsError} selection={selection} onSelect={setSelection} open={modelOpen} onOpenChange={setModelOpen} refresh={refreshModels} admin={user?.role === 'admin'}/>
      <OverlayPanel open={historyOpen} onOpenChange={setHistoryOpen} title="近期任务" description="AI 任务结果保留 7 天，选择任务即可继续。"><div className="history-toolbar"><span>{jobs.length} 个任务</span><button className="text-button" disabled={historyLoading} aria-label="刷新任务" onClick={() => refreshJobs().catch(() => {})}><RefreshCw size={13} className={historyLoading ? 'spin' : ''}/>刷新</button></div>{historyError && <p className="error-text" role="alert">{historyError}</p>}<div className="history">{jobs.length ? jobs.map(job => <div className={`job ${activeJob?.id === job.id ? 'selected' : ''}`} key={job.id}><button className="job-main" disabled={busy || running} onClick={() => openJob(job)}><span className="job-file"><FileText size={19}/></span><span><b>{job.name}</b><small><i className={`status-dot ${job.status}`}/>{statusNames[job.status]} · {new Date(job.created_at).toLocaleDateString('zh-CN')} · {job.mode === 'personal' ? '个人服务' : '团队服务'}</small></span><ChevronRight size={16}/></button><Tip text="删除云端任务"><button className="icon-button job-delete" aria-label={`删除任务 ${job.name}`} disabled={busy || running} onClick={e => { deleteTrigger.current = e.currentTarget; setPendingDelete(job); }}><Trash2 size={15}/></button></Tip></div>) : <div className="no-results"><span className="empty-icon"><Clock3 size={24}/></span><b>{historyLoading ? '正在读取任务' : '下一场会议，从这里开始'}</b><p>上传资料后，AI 任务会出现在这里。</p></div>}</div>{activeJob && <Disclosure title="当前任务的模型与用量" open={sourceOpen} onToggle={() => setSourceOpen(!sourceOpen)}><p className="task-model-note">{providerNames[activeJob.provider]} · {activeJob.model}<br/>{activeJob.input_tokens.toLocaleString()} 输入 / {activeJob.output_tokens.toLocaleString()} 输出 Token{activeJob.usage_estimated ? '（含估计用量）' : ''}{activeJob.estimated_usd === null ? '' : ` · 预估 $${activeJob.estimated_usd.toFixed(4)}`}</p></Disclosure>}</OverlayPanel>
      <OverlayPanel open={helpOpen} onOpenChange={setHelpOpen} title="三步，准备一场好对话" description="把会议里容易译错的词，提前整理好。" className="help-dialog"><ol className="guide-steps"><li><span>01</span><div><h3>准备资料</h3><p>上传会议文档或双语对照表。双语表沿用原译法，其他文字资料可由 AI 提取。</p></div></li><li><span>02</span><div><h3>核对词条</h3><p>直接修改原词与译文，勾选“指定翻译”确认译法。点击词条旁的“…”查看出处、调整重要度或设置必保。</p></div></li><li><span>03</span><div><h3>下载词库</h3><p>分别下载热词清单和指定翻译 TXT。也可以保存 JSON 审核项目，之后继续编辑。</p></div></li></ol><details className="help-details"><summary>支持的资料与读取范围</summary><p>单文件最大 20 MB。支持文字型 PDF（最多 80 页）、Excel、Word、TXT 和 CSV；每表最多 5,000 行。扫描 PDF、图片中的文字暂不支持，需先转成文字文档。</p><p>AI 处理所选文本，最多 120,000 字符。上传后可选择页码 / 工作表，并查看原文预览。</p></details><details className="help-details"><summary>TXT 格式与字数规则</summary><FormatPlayground/><p>热词上限 2,048，指定翻译上限 20,480 个 UTF-16 字符，包含 BOM 与 CRLF。英文短语与中文词组完整保留；条目内部的连字符、逗号会换为空格。</p><p>超限时按必保、专名与重要度取舍完整条目；必保超限或冲突会阻止下载。尚未确认的 AI 建议译法需先人工确认。</p></details></OverlayPanel>
      <OverlayPanel open={!!edited} onOpenChange={open => { if (!open) setEditingTerm(undefined); }} title="词条详情" description="查看原文依据，调整这个词的取舍方式。" className="term-dialog">{edited && <><div className="term-edit-fields"><label>原词<input aria-label={`详细原词 ${edited.source}`} maxLength={180} value={edited.source} onChange={e => update(edited.id, { source: e.target.value, basis: 'manual' })}/></label><label>译文<input aria-label={`详细译文 ${edited.source}`} maxLength={180} value={edited.target} onChange={e => update(edited.id, { target: e.target.value, basis: 'manual', translation: false })} placeholder="填写完整译文"/></label><label>类别<select aria-label={`类别 ${edited.source}`} value={edited.category} onChange={e => update(edited.id, { category: e.target.value as Category })}>{Object.entries(categoryNames).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label>重要度<PrioritySlider label={`重要度 ${edited.source}`} value={edited.priority} onChange={v => update(edited.id, { priority: v })}/></label></div><div className="term-detail-toggles"><Switch checked={edited.pinned} onChange={v => update(edited.id, { pinned: v })} label={`必保 ${edited.source}`}/><Toggle label={`详情指定翻译 ${edited.source}`} text="确认指定翻译" checked={edited.translation} disabled={!edited.target.trim()} onChange={v => update(edited.id, { translation: v })}/></div><div className="evidence-card"><span className="small-kicker">原文依据 · {edited.location || '手动录入'}</span><p>{edited.evidence || '这个词条由你手动添加。'}</p></div>{excluded.filter(e => e.id === edited.id).map((e, i) => <p className="error-text" key={i}>{e.reason}</p>)}<div className="dialog-actions"><button className="text-button remove-term" aria-label={`删除词条 ${edited.source}`} onClick={() => { removeTerm(edited); setEditingTerm(undefined); }}><Trash2 size={14}/>移除词条</button><button className="button primary" onClick={() => setEditingTerm(undefined)}>完成<Check size={15}/></button></div></>}</OverlayPanel>
      <input ref={input} hidden type="file" accept=".pdf,.xlsx,.docx,.txt,.csv" onChange={e => { if (e.target.files?.[0]) readFile(e.target.files[0]); e.target.value = ''; }}/>
      <input ref={projectInput} hidden type="file" accept=".json" onChange={e => { if (e.target.files?.[0]) importProject(e.target.files[0]); e.target.value = ''; }}/>
      <ConfirmDialog open={!!pendingDelete} onClose={() => setPendingDelete(undefined)} onConfirm={deleteJob} busy={deleting} title="删除这个云端任务？" returnFocus={() => deleteTrigger.current?.isConnected ? deleteTrigger.current.focus() : document.querySelector<HTMLButtonElement>('[aria-label="刷新任务"]')?.focus()}>{pendingDelete?.name} 的任务记录及云端文件将被删除。</ConfirmDialog>
      <AnimatePresence>{toast && <motion.div key={toast.id} className="toast" role="status" initial={{ opacity: 0, y: 24, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: .96 }}><span className="toast-check"><Check size={14}/></span><span>{toast.message}</span>{toast.action && <button onClick={toast.action}>撤销</button>}<button className="toast-close" aria-label="关闭操作提示" onClick={() => setToast(undefined)}><X size={14}/></button></motion.div>}</AnimatePresence>
    </div>
  </Tooltip.Provider></MotionConfig>;
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

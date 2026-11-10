import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Download, FileText, FolderOpen, Globe2, Layers3, Plus, ShieldCheck, Sparkles, Trash2, UploadCloud, X } from 'lucide-react';
import { api } from './api';
import { CandidateSchema, categoryNames, type Candidate, type Category, type ExtractionResult, type Job, type ParsedFile } from '../shared/schema';
import { compileHotwords, compileTranslations, fileText, validateExport, type Compiled } from '../shared/compiler';
import { importTable } from '../shared/table-import';

type User = { email: string; local: boolean; model: string };
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
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [parsed, setParsed] = useState<ParsedFile>();
  const [selected, setSelected] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [activeJob, setActiveJob] = useState<Job>();
  const [sourceColumn, setSourceColumn] = useState(0), [targetColumn, setTargetColumn] = useState(1);
  const [skipHeader, setSkipHeader] = useState(true), [bidirectional, setBidirectional] = useState(false);
  const [query, setQuery] = useState(''), [category, setCategory] = useState('all');
  const [view, setView] = useState<'all' | 'review' | 'excluded'>('all');
  const [page, setPage] = useState(0);
  const [example, setExample] = useState(false);
  const input = useRef<HTMLInputElement>(null), projectInput = useRef<HTMLInputElement>(null);
  const parseWorker = useRef<Worker | null>(null);
  const segments = useMemo(() => parsed?.segments.filter(s => selected.includes(s.id)) ?? [], [parsed, selected]);
  const chars = segments.reduce((n, s) => n + s.text.length, 0);
  const tableMode = segments.some(s => s.rows);
  const columns = Math.max(2, ...segments.flatMap(s => s.rows?.slice(0, 10).map(r => r.length) ?? []));
  const hot = useMemo(() => compileHotwords(candidates), [candidates]);
  const translations = useMemo(() => compileTranslations(candidates, bidirectional), [candidates, bidirectional]);
  const excluded = [...hot.excluded, ...translations.excluded];
  const excludedIds = new Set(excluded.map(e => e.id));
  const visible = candidates.filter(c => (!query || `${c.source} ${c.target} ${c.location}`.toLowerCase().includes(query.toLowerCase()))
    && (category === 'all' || c.category === category)
    && (view === 'all' || (view === 'review' ? c.basis === 'suggested' || /[/／]/.test(c.source + c.target) : excludedIds.has(c.id))));
  const pages = Math.ceil(visible.length / 30);
  useEffect(() => { setPage(0); }, [query, category, view]);
  useEffect(() => { setPage(p => Math.min(p, Math.max(0, pages - 1))); }, [pages]);

  async function refreshJobs() { setJobs(await api<Job[]>('/api/jobs')); }
  useEffect(() => {
    api<User>('/api/me').then(setUser).catch(e => setError(e.message));
    refreshJobs().catch(() => {});
    return () => { parseWorker.current?.terminate(); };
  }, []);
  useEffect(() => {
    if (!activeJob || !['queued', 'running'].includes(activeJob.status)) return;
    const timer = window.setTimeout(async () => {
      try {
        const job = await api<Job>(`/api/jobs/${activeJob.id}`); setActiveJob(job);
        if (job.status === 'completed') {
          const result = await api<ExtractionResult>(`/api/jobs/${job.id}/result`);
          setCandidates(result.candidates); setWarnings(result.warnings); setExample(false);
          await refreshJobs();
        } else if (job.status === 'failed') { setError(job.error || '任务失败'); await refreshJobs(); }
      } catch (e) { setError((e as Error).message); setActiveJob(undefined); }
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [activeJob]);

  async function readFile(file: File) {
    parseWorker.current?.terminate();
    setBusy(true); setError(''); setParsed(undefined); setSelected([]);
    const worker = new Worker(new URL('./parser.worker.ts', import.meta.url), { type: 'module' });
    parseWorker.current = worker;
    const timeout = window.setTimeout(() => { worker.terminate(); setBusy(false); setError('读取超过 90 秒，请拆分文件或检查文件是否损坏'); }, 90000);
    worker.onmessage = (event: MessageEvent<{ ok: boolean; file?: ParsedFile; error?: string }>) => {
      window.clearTimeout(timeout); worker.terminate(); setBusy(false);
      if (!event.data.ok || !event.data.file) { setError(event.data.error || '读取失败'); return; }
      const result = event.data.file;
      setParsed(result); setSelected(result.segments.filter(s => s.text.trim()).map(s => s.id));
      setName(file.name.replace(/\.[^.]+$/, '').slice(0, 100)); setWarnings(result.warnings);
      setCandidates([]); setActiveJob(undefined); setExample(false);
    };
    worker.onerror = () => { window.clearTimeout(timeout); worker.terminate(); setBusy(false); setError('文件读取失败，请检查格式或改用 TXT'); };
    worker.postMessage(file);
  }
  function directImport() {
    setError('');
    if (sourceColumn === targetColumn) { setError('原词列和译文列不能相同'); return; }
    const result = importTable(segments, sourceColumn, targetColumn, skipHeader);
    if (!result.candidates.length) { setError('所选工作表及列中没有可导入的词条'); return; }
    setCandidates(result.candidates); setWarnings([...(parsed?.warnings ?? []), ...result.warnings]); setExample(false);
  }
  async function extract() {
    setBusy(true); setError('');
    try {
      const created = await api<{ id: string }>('/api/jobs', { method: 'POST', body: JSON.stringify({ name, segments: segments.map(({ id, label, text }) => ({ id, label, text })) }) });
      setCandidates([]); setExample(false);
      setActiveJob(await api<Job>(`/api/jobs/${created.id}`)); await refreshJobs();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function openJob(job: Job) {
    setName(job.name); setActiveJob(job); setError(''); setParsed(undefined); setSelected([]); setCandidates([]);
    if (job.status === 'completed') {
      try { const result = await api<ExtractionResult>(`/api/jobs/${job.id}/result`); setCandidates(result.candidates); setWarnings(result.warnings); setExample(false); }
      catch (e) { setError((e as Error).message); }
    }
  }
  async function deleteJob(job: Job) {
    try { await api(`/api/jobs/${job.id}`, { method: 'DELETE' }); if (activeJob?.id === job.id) setActiveJob(undefined); await refreshJobs(); }
    catch (e) { setError((e as Error).message); }
  }
  function update(id: string, patch: Partial<Candidate>) {
    setCandidates(c => c.map(term => term.id === id ? { ...term, ...patch } : term));
  }
  function exportTxt(kind: 'hot' | 'translation', compiled: Compiled) {
    try {
      if (compiled.errors.length) throw new Error(compiled.errors.join('；'));
      validateExport(compiled.content, kind);
      download(`${kind === 'hot' ? '热词清单' : '指定翻译'}_${safeName(name)}.txt`, fileText(compiled.content));
    } catch (e) { setError((e as Error).message); }
  }
  async function importProject(file: File) {
    try {
      if (file.size > 5_000_000) throw new Error('审核项目文件过大');
      const result = JSON.parse(await file.text());
      if (result.version !== 1 || !Array.isArray(result.candidates) || result.candidates.length > 20000 || typeof result.name !== 'string') throw new Error('不是有效的词准项目');
      const terms = result.candidates.map((c: unknown) => CandidateSchema.parse(c));
      if (new Set(terms.map((c: Candidate) => c.id)).size !== terms.length) throw new Error('项目内存在重复词条 ID');
      setCandidates(terms); setName(result.name.slice(0, 100)); setParsed(undefined); setSelected([]); setActiveJob(undefined); setWarnings([]); setExample(false); setError('');
    } catch { setError('项目文件无效，请导入由本工具保存的 JSON 审核项目'); }
  }
  const running = !!activeJob && ['queued', 'running'].includes(activeJob.status);

  return <div className="layout">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">词</div><div><strong>词准</strong><span>GLOSSARY STUDIO</span></div></div>
      <div className="workspace-label">会议翻译 · 团队工作台</div>
      <button className="nav-item active" onClick={() => document.querySelector('main')?.scrollIntoView()}><Layers3 size={19} />术语工作台<span>01</span></button>
      <button className="nav-item" onClick={() => projectInput.current?.click()}><FolderOpen size={19} />导入审核项目</button>
      <div className="history-heading">我的近期任务<button aria-label="刷新任务" onClick={() => refreshJobs().catch(e => setError(e.message))}>↻</button></div>
      <div className="history">{jobs.length ? jobs.map(job => <div className="job" key={job.id}><button className="job-main" onClick={() => openJob(job)}><FileText size={16}/><span><b>{job.name}</b><small>{statusNames[job.status]} · {new Date(job.created_at).toLocaleDateString('zh-CN')}</small></span></button><button className="icon-button" aria-label={`删除任务 ${job.name}`} title="删除任务及云端文件" onClick={() => deleteJob(job)}><Trash2 size={14}/></button></div>) : <p className="muted small">AI 任务会保留 7 天。<br/>原表导入在当前浏览器完成。</p>}</div>
      <div className="sidebar-bottom"><ShieldCheck size={18}/><div><b>{user?.local ? '本地开发模式' : '团队成员空间'}</b><span>{user?.email ?? '正在验证登录…'}</span></div></div>
    </aside>
    <main>
      <header className="topbar"><span>工作台 <span className="slash">/</span> 新建词库</span><span className="top-meta"><Globe2 size={15}/> 中文 ⇄ English <span className="pill">团队版</span></span></header>
      <div className="main-body">
        <div className="intro"><div><div className="eyebrow"><span/>为每一场会议，准备准确的词</div><h1>把会议资料，变成可用词库。</h1><p>上传资料，审核完整词条，导出符合导入要求的热词与指定翻译。</p></div><button className="text-button" onClick={() => { setName('格式示例'); setCandidates(demo); setWarnings([]); setParsed(undefined); setSelected([]); setActiveJob(undefined); setExample(true); }}>查看格式示例 <ArrowRight size={16}/></button></div>
        <div className="steps"><div className="step current"><span>1</span>上传与选择资料</div><i/><div className={`step ${candidates.length ? 'current' : ''}`}><span>2</span>审核与精简词条</div><i/><div className={`step ${candidates.length ? 'current' : ''}`}><span>3</span>下载两份 TXT</div></div>
        {error && <div className="alert error" role="alert">{error}<button aria-label="关闭提示" onClick={() => setError('')}><X size={16}/></button></div>}
        {example && <div className="alert">当前为格式演示，正式词库请使用实际会议资料。</div>}
        <section className="upload-section panel">
          <div className="section-title"><h2><span>01</span>准备会议资料</h2><span className="muted small">单文件 ≤ 20 MB</span></div>
          <div className="upload-grid">
            <button className={`dropzone ${busy ? 'loading' : ''}`} disabled={busy || running} onClick={() => input.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy && !running && e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); }}>
              <div className="upload-icon"><UploadCloud size={28}/></div><strong>{busy ? '正在读取资料…' : parsed ? parsed.name : '点击或拖入会议资料'}</strong><span>PDF / Excel / Word / TXT / CSV</span><small>读取后可选择 PDF 页码或 Excel 工作表</small>
            </button>
            <div className="upload-options"><label className="field-label" htmlFor="project-name">项目名称</label><input id="project-name" maxLength={100} value={name} onChange={e => setName(e.target.value)} placeholder="例如：国际复材 2026 年会议"/><div className="rule-note"><ShieldCheck size={18}/><p>原文件在浏览器中读取。AI 提取只发送所选内容，既有双语表可直接导入。</p></div><div className="limit-chips"><span>热词 <b>2,048</b> 字符</span><span>指定翻译 <b>20,480</b> 字符</span></div></div>
          </div>
          {parsed && <div className="source-options"><div className="selection-heading"><b>选择参与提取的内容</b><span>{selected.length} 项 · {chars.toLocaleString()} 字符</span><button className="text-button" onClick={() => setSelected(selected.length ? [] : parsed.segments.filter(s => s.text.trim()).map(s => s.id))}>{selected.length ? '取消全选' : '全选'}</button></div><div className="segment-list">{parsed.segments.map(segment => <label key={segment.id}><input type="checkbox" disabled={!segment.text.trim() || running} checked={selected.includes(segment.id)} onChange={e => setSelected(s => e.target.checked ? [...s, segment.id] : s.filter(id => id !== segment.id))}/><span>{segment.label}</span><small>{segment.text.length.toLocaleString()} 字</small></label>)}</div>
            <details><summary>查看所选原文，确认读取内容</summary><pre className="source-preview">{segments.map(s => `[${s.label}]\n${s.text}`).join('\n\n')}</pre></details>
            {tableMode && <div className="table-options"><strong>已有双语对照表</strong><label>原词列 <select value={sourceColumn} onChange={e => setSourceColumn(Number(e.target.value))}>{Array.from({ length: columns }, (_, i) => <option key={i} value={i}>{letter(i)} 列</option>)}</select></label><label>译文列 <select value={targetColumn} onChange={e => setTargetColumn(Number(e.target.value))}>{Array.from({ length: columns }, (_, i) => <option key={i} value={i}>{letter(i)} 列</option>)}</select></label><label><input type="checkbox" checked={skipHeader} onChange={e => setSkipHeader(e.target.checked)}/>跳过每表首行</label><button className="button secondary" disabled={!segments.length || running} onClick={directImport}>按原表导入</button><div className="table-sample">{segments.filter(s => s.rows).slice(0, 1).map(s => <span key={s.id}>前两行预览：{s.rows!.slice(0, 2).map((r, i) => <code key={i}>{r[sourceColumn] || '（空）'} → {r[targetColumn] || '（空）'}</code>)}</span>)}</div></div>}
            <div className="extract-action"><p>{chars > 120000 ? '所选文字超过 120000 字符，请减少页面 / 工作表或分批处理。' : 'AI 优先识别人名、地名、专名和容易误译的中英文术语。'}</p><button className="button primary" disabled={!user || busy || running || !name.trim() || !chars || chars > 120000} onClick={extract}><Sparkles size={17}/>AI 提取候选词 <ArrowRight size={17}/></button></div>
          </div>}
        </section>
        {running && <div className="progress-panel panel"><Sparkles size={23}/><div><b>{statusNames[activeJob!.status]} · {activeJob!.name}</b><p>已完成 {activeJob!.progress} / {activeJob!.total || '…'} 个片段。可离开页面，稍后从近期任务恢复。</p><progress value={activeJob!.progress} max={activeJob!.total || 1}/></div></div>}
        {warnings.length > 0 && <details className="warnings"><summary>{warnings.length} 条读取 / 审核提示</summary><ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>}
        {candidates.length > 0 && <>
          <section className="review-section panel"><div className="section-title"><h2><span>02</span>审核与精简词条</h2><button className="text-button" onClick={() => setCandidates(c => [...c, { id: crypto.randomUUID(), source: '新词条', target: '', category: 'other', priority: 80, basis: 'manual', evidence: '', location: '手动添加', hot: true, translation: false, pinned: false }])}><Plus size={16}/>添加词条</button></div>
            <p className="review-description">勾选“指定翻译”即确认该译法。人名、地名优先保留；“必保”可提高条目优先级。未纳入的完整条目会列出原因。</p>
            <div className="toolbar"><input aria-label="搜索词条" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索原词、译文或出处…"/><select aria-label="词条类别筛选" value={category} onChange={e => setCategory(e.target.value)}><option value="all">全部类别</option>{Object.entries(categoryNames).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><div className="view-tabs">{([['all','全部'],['review','待审核'],['excluded','未纳入']] as const).map(([v, label]) => <button key={v} className={view === v ? 'selected' : ''} onClick={() => setView(v)}>{label}</button>)}</div><span className="muted small">{visible.length} 条</span></div>
            <div className="table-scroll"><table><thead><tr><th className="check-column">热词</th><th className="check-column">指定翻译</th><th>原词</th><th>译文</th><th>类别</th><th>重要度</th><th className="check-column">必保</th><th>依据 / 出处</th><th/></tr></thead><tbody>{visible.slice(page * 30, page * 30 + 30).map(c => <tr key={c.id} className={excludedIds.has(c.id) ? 'excluded-row' : ''}><td className="check-column"><input aria-label={`热词 ${c.source}`} type="checkbox" checked={c.hot} onChange={e => update(c.id, { hot: e.target.checked })}/></td><td className="check-column"><input aria-label={`指定翻译 ${c.source}`} type="checkbox" checked={c.translation} disabled={!c.target.trim()} onChange={e => update(c.id, { translation: e.target.checked })}/></td><td><input className="cell-input" aria-label={`原词 ${c.source}`} maxLength={180} value={c.source} onChange={e => update(c.id, { source: e.target.value, basis: 'manual' })}/></td><td><input className="cell-input" aria-label={`译文 ${c.source}`} maxLength={180} value={c.target} onChange={e => update(c.id, { target: e.target.value, basis: 'manual', translation: false })} placeholder="未确认译名，留空"/>{c.basis === 'suggested' && <span className="suggestion-tag">AI 建议 · 待确认</span>}</td><td><select aria-label={`类别 ${c.source}`} value={c.category} onChange={e => update(c.id, { category: e.target.value as Category })}>{Object.entries(categoryNames).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td><td><input className="priority-input" aria-label={`重要度 ${c.source}`} type="number" min={0} max={100} value={c.priority} onChange={e => update(c.id, { priority: Math.max(0, Math.min(100, Number(e.target.value))) })}/></td><td className="check-column"><input aria-label={`必保 ${c.source}`} type="checkbox" checked={c.pinned} onChange={e => update(c.id, { pinned: e.target.checked })}/></td><td className="evidence"><details><summary>{c.location || '手动'}{c.basis === 'source' && <Check size={12}/>}</summary><p>{c.evidence || '手动录入'}</p></details>{excluded.filter(e => e.id === c.id).map((e, i) => <small key={i}>{e.reason}</small>)}</td><td><button className="icon-button" aria-label={`删除词条 ${c.source}`} onClick={() => setCandidates(all => all.filter(t => t.id !== c.id))}><X size={14}/></button></td></tr>)}</tbody></table></div>
            <div className="review-footer"><span>按人名 → 地名 → 机构 → 产品 → 行业术语排序，每类按重要度取舍。</span><div><button disabled={page === 0} onClick={() => setPage(p => p - 1)}>上一页</button><span>{pages ? page + 1 : 0} / {pages}</span><button disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)}>下一页</button></div></div>
          </section>
          <section className="export-section"><div className="export-heading"><h2><span>03</span>导出会议词库</h2><label><input type="checkbox" checked={bidirectional} onChange={e => setBidirectional(e.target.checked)}/>指定翻译生成双向映射</label></div><div className="export-grid"><ExportCard kind="hot" title="热词清单" description="中英文完整词条，以中文逗号分隔" compiled={hot} limit={2048} onDownload={() => exportTxt('hot', hot)}/><ExportCard kind="translation" title="指定翻译" description="原词-译文，以中文逗号分隔完整映射" compiled={translations} limit={20480} onDownload={() => exportTxt('translation', translations)}/></div>
            <div className="save-review"><p>字符数已包含 UTF-8 BOM 和 Windows 换行。下载前逐条检查格式；不会截断词组。</p><button className="text-button" onClick={() => download(`审核项目_${safeName(name)}.json`, JSON.stringify({ version: 1, name, candidates }, null, 2), true)}><Download size={16}/>保存可继续编辑的审核项目</button></div>
          </section>
        </>}
        {!candidates.length && !parsed && <div className="getting-started"><div><FileText size={22}/><h3>保留完整词条</h3><p>英语短语保持完整，中文词组不拆字。</p></div><div><ShieldCheck size={22}/><h3>格式确定，字数可控</h3><p>两份 TXT 按固定规则生成，严格检查上限。</p></div><div><Sparkles size={22}/><h3>关注真正容易出错的词</h3><p>优先人名、地名、专名与关键行业术语。</p></div></div>}
        <footer>词准 · 会议术语工作台 <span>每一个词，都值得准确。</span></footer>
      </div>
    </main>
    <input ref={input} hidden type="file" accept=".pdf,.xlsx,.docx,.txt,.csv" onChange={e => { if (e.target.files?.[0]) readFile(e.target.files[0]); e.target.value = ''; }}/>
    <input ref={projectInput} hidden type="file" accept=".json" onChange={e => { if (e.target.files?.[0]) importProject(e.target.files[0]); e.target.value = ''; }}/>
  </div>;
}
function ExportCard({ kind, title, description, compiled, limit, onDownload }: { kind: string; title: string; description: string; compiled: Compiled; limit: number; onDownload: () => void }) {
  return <div className={`export-card panel ${kind}`}><div className="export-card-top"><div className="file-icon"><FileText size={23}/><small>TXT</small></div><div><h3>{title}</h3><p>{description}</p></div><span className="format-badge"><Check size={13}/>格式已校验</span></div><div className="character-count"><strong>{compiled.chars.toLocaleString()}</strong><span>/ {limit.toLocaleString()} 字符</span><small>{compiled.count} 条完整词条</small></div><div className="budget-bar"><span style={{ width: `${compiled.chars / limit * 100}%` }}/></div><pre className="output-preview">{compiled.content || '勾选词条后显示预览'}</pre>{compiled.errors.map(e => <p className="error-text" key={e}>{e}</p>)}<details className="export-details"><summary>未纳入 {compiled.excluded.length} 条 · 格式调整 {compiled.changes.length} 处</summary><ul>{compiled.excluded.map((e, i) => <li key={i}>{e.term}：{e.reason}</li>)}{compiled.changes.map((c, i) => <li key={`change-${i}`}>{c}</li>)}</ul></details><button className="button primary" disabled={!compiled.count || !!compiled.errors.length} onClick={onDownload}><Download size={16}/>下载{title}.txt</button></div>;
}

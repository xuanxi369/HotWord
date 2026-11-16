import type { ReactNode } from 'react';
import { AlertCircle, Check, CheckCircle2, ChevronRight, FileCheck2, Sparkles, Upload, Users, X } from 'lucide-react';
import type { RosterWorkspace } from '../hooks/useRosterWorkspace';

export function WorkspaceLayout({ work, disabled, children }: { work: RosterWorkspace; disabled: boolean; children: ReactNode }) {
  const { excelName, resultModel } = work.workspace;
  const { view, setView, reading, busy, exporting, exported, error, setError, notice, loadDemo } = work;
  return <main id="seating-workspace">
    <div className="page-heading">
      <div><span className="eyebrow">让每一位来宾都有归属</span><h1>{view === 'upload' ? '从座次表，到人员库。' : '核对一下，就可以导出。'}</h1>
        <p>{view === 'upload' ? '上传座次图和 Excel，识别分区，核对后带走完整名单。' : `${excelName} · ${resultModel}`}</p></div>
      <div className="heading-actions">{view === 'upload'
        ? <button className="secondary-btn" onClick={loadDemo} disabled={busy || reading || exporting || disabled}><Sparkles size={16}/>体验示例</button>
        : <button className="secondary-btn" disabled={busy || reading || exporting} onClick={() => { setView('upload'); setError(''); }}><Upload size={16}/>返回准备资料</button>}</div>
    </div>
    <nav className="stepper" aria-label="座次整理流程">
      {[{ icon: Upload, label: '准备资料', detail: '座次图 + 座次表' }, { icon: Users, label: '核对人员', detail: '检查分区与名单' }, { icon: FileCheck2, label: '导出人员库', detail: '标准五字段 Excel' }].map((step, i) => {
        const Icon = step.icon, current = view === 'upload' ? i === 0 : !exported ? i === 1 : i === 2;
        const done = view === 'review' && i === 0 || exported && i === 1;
        return <div className={`step ${current ? 'current' : ''} ${done ? 'done' : ''}`} key={step.label} aria-current={current ? 'step' : undefined}>
          <span className="step-icon">{done ? <Check size={18}/> : <Icon size={18}/>}</span><div><strong>{step.label}</strong><span>{step.detail}</span></div>{i < 2 && <ChevronRight className="step-chevron" size={17}/>}</div>;
      })}
    </nav>
    {error && <div className="error-box" role="alert"><AlertCircle size={18}/>{error}<button className="icon-btn" aria-label="关闭错误提示" onClick={() => setError('')}><X size={16}/></button></div>}
    {notice && <div className="notice-box" role="status"><CheckCircle2 size={17}/>{notice}</div>}
    {children}
    <footer className="page-footer"><span>姓名 · 手机号 · 单位 · 职务 · 分座区域</span><span>草稿保存在此浏览器，请留意保存状态。</span></footer>
  </main>;
}

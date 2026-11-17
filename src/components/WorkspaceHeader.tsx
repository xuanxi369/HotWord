import type { ReactNode } from 'react';
import { CircleHelp, Layers3, Moon, Settings2, Sun } from 'lucide-react';
import { Tip } from './ui';
import type { Theme } from '../theme';
import type { WorkspacePage } from '../pages';

export function WorkspaceHeader({ page, navigate, theme, setTheme, email, local, onHome, onModels, onHelp, children }: {
  page: WorkspacePage; navigate: (page: WorkspacePage) => void; theme: Theme; setTheme: (theme: Theme) => void;
  email?: string; local?: boolean; onHome: () => void; onModels: () => void; onHelp: () => void; children?: ReactNode;
}) {
  return <header className="app-header">
    <a className="brand" href={page === 'seating' ? '#seating-workspace' : '#workspace'} onClick={onHome} aria-label="HotWord 工作台"><span className="brand-mark"><Layers3 size={21}/></span><strong>HotWord<span>会议术语工作台。</span></strong></a>
    <nav className="header-nav workbench-nav" aria-label="工作台导航">
      {([{ page: 'conference', label: '会议词库', tip: '上传会议资料，核对并导出专属词库。' }, { page: 'seating', label: '座次人员库', tip: '上传座次图与 Excel，识别分区、核对名单并导出人员库。' }, { page: 'multilingual', label: '多语对照', tip: '选择原文与译文语言，整理双语词条和指定翻译。' }] as const).map(item =>
        <Tip key={item.page} text={item.tip}><button className={`workspace-link ${page === item.page ? 'header-current' : ''}`} aria-current={page === item.page ? 'page' : undefined} onClick={() => navigate(item.page)}>{item.label}</button></Tip>)}
    </nav>
    <div className="header-actions">
      {children}
      <Tip text={theme === 'dark' ? '切换到明亮模式' : '切换到暗夜模式'}><button className="icon-button theme-button" aria-label={theme === 'dark' ? '切换到明亮模式' : '切换到暗夜模式'} aria-pressed={theme === 'dark'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={18}/> : <Moon size={18}/>}</button></Tip>
      <Tip text="模型与密钥"><button className="icon-button" aria-label="模型与密钥" onClick={onModels}><Settings2 size={18}/></button></Tip>
      <Tip text="使用指南"><button className="icon-button" aria-label="使用指南" onClick={onHelp}><CircleHelp size={18}/></button></Tip>
      <span className="header-divider"/><Tip text={email || '正在验证登录'}><span className="avatar" aria-label={local ? '本地开发模式' : '团队成员'}>{email?.[0]?.toUpperCase() || 'H'}</span></Tip>
    </div>
  </header>;
}

import { useState } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { useRosterWorkspace } from './hooks/useRosterWorkspace';
import { useDraft } from './hooks/useDraft';
import { hasWorkspace } from './lib/workspace';
import { WorkspaceLayout } from './components/WorkspaceLayout';
import { DraftPanel } from './components/DraftPanel';
import { MappingEditor } from './components/MappingEditor';
import { HelpDialog } from './components/HelpDialog';
import { UploadPage } from './pages/UploadPage';
import { ReviewPage } from './pages/ReviewPage';
import { WorkspaceHeader } from '../components/WorkspaceHeader';
import { ModelPanel } from '../components/ModelSettings';
import { selectionAvailable } from '../model-selection';
import type { WorkspaceSession } from '../useWorkspaceSession';
import type { Theme } from '../theme';
import type { WorkspacePage } from '../pages';

export default function SeatingWorkbench({ active, session, theme, setTheme, navigate }: {
  active: boolean; session: WorkspaceSession; theme: Theme; setTheme: (theme: Theme) => void;
  navigate: (page: WorkspacePage) => void;
}) {
  const work = useRosterWorkspace();
  const draft = useDraft(work.workspace, work.restoreWorkspace, session.user?.email);
  const [showSettings, setShowSettings] = useState(false), [showMapping, setShowMapping] = useState(false), [showHelp, setShowHelp] = useState(false);
  const awaitingRecovery = !draft.ready || !!draft.pending;
  async function analyze() {
    if (!session.selection || !session.modelSettings || !selectionAvailable(session.selection, session.modelSettings)) {
      setShowSettings(true); return;
    }
    await work.analyze(session.selection);
    await session.refreshModels().catch(() => {});
  }
  async function clearWorkspace() {
    if (work.busy || work.reading || work.exporting) return;
    if (await draft.discard()) { work.reset(); setShowMapping(false); }
  }
  // Hooks remain mounted on navigation, including in-flight recognition and autosave.
  if (!active) return null;
  return <Tooltip.Provider delayDuration={350}>
    <div className="layout seating-layout">
      <WorkspaceHeader page="seating" navigate={navigate} theme={theme} setTheme={setTheme} email={session.user?.email} local={session.user?.local}
        onHome={() => work.setView('upload')} onModels={() => setShowSettings(true)} onHelp={() => setShowHelp(true)}/>
      <div className="seating-workspace">
        <WorkspaceLayout work={work} disabled={awaitingRecovery}>
          {session.userError && <div className="error-box" role="alert">{session.userError}</div>}
          <DraftPanel draft={draft} hasWork={hasWorkspace(work.workspace)} onClear={() => { void clearWorkspace(); }}/>
          {work.view === 'upload' ? <UploadPage work={work} session={session} onSettings={() => setShowSettings(true)}
            onAnalyze={() => { void analyze(); }} onManual={() => { if (work.startManual()) setShowMapping(true); }} disabled={awaitingRecovery}/>
            : <ReviewPage work={work} onMapping={() => setShowMapping(true)}/>}
        </WorkspaceLayout>
        {showMapping && work.workspace.plan && <MappingEditor plan={work.workspace.plan} sheets={work.activeSheets} onClose={() => setShowMapping(false)} onSave={plan => { work.savePlan(plan); setShowMapping(false); }}/>}
        {showHelp && <HelpDialog onClose={() => setShowHelp(false)}/>}
      </div>
      <ModelPanel settings={session.modelSettings} loading={session.modelsLoading} loadError={session.modelsError} selection={session.selection} onSelect={session.setSelection}
        open={showSettings} onOpenChange={setShowSettings} refresh={async () => { await session.refreshModels(); }} admin={session.user?.role === 'admin'}/>
    </div>
  </Tooltip.Provider>;
}

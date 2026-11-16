import { useCallback, useEffect, useRef, useState } from 'react';
import Workbench, { type WorkbenchPage, type WorkbenchTransfer } from './Workbench';
import { applyTheme, currentTheme } from './theme';
import { useWorkspaceSession } from './useWorkspaceSession';
import SeatingWorkbench from './seating/SeatingWorkbench';
import { pageForPath, workspacePaths, type WorkspacePage } from './pages';
import { AmbientBackground } from './components/AmbientBackground';

const currentPage = (): WorkspacePage => pageForPath(window.location.pathname);

export default function App() {
  const [page, setPage] = useState(currentPage);
  const [theme, setTheme] = useState(currentTheme);
  const [transfer, setTransfer] = useState<WorkbenchTransfer>();
  const transferId = useRef(0);
  const [busy, setBusy] = useState({ conference: false, multilingual: false });
  const session = useWorkspaceSession();
  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => { document.title = `HotWord · ${{ conference: '会议词库', multilingual: '多语对照', seating: '座次人员库' }[page]}`; }, [page]);
  useEffect(() => {
    const restorePage = () => setPage(currentPage());
    window.addEventListener('popstate', restorePage);
    return () => window.removeEventListener('popstate', restorePage);
  }, []);
  const onAvailabilityChange = useCallback((target: WorkbenchPage, value: boolean) => {
    setBusy(current => current[target] === value ? current : { ...current, [target]: value });
  }, []);
  function navigate(target: WorkspacePage, incoming?: Omit<WorkbenchTransfer, 'id' | 'page'>) {
    if (incoming && target !== 'seating') setTransfer({ ...incoming, page: target, id: ++transferId.current });
    if (currentPage() !== target) window.history.pushState(null, '', workspacePaths[target]);
    setPage(target);
  }
  return <>
    <AmbientBackground/>
    <Workbench page="conference" active={page === 'conference'} session={session} theme={theme} setTheme={setTheme}
      transfer={transfer} targetBusy={busy.multilingual} navigate={navigate} onAvailabilityChange={onAvailabilityChange}/>
    <SeatingWorkbench active={page === 'seating'} session={session} theme={theme} setTheme={setTheme} navigate={navigate}/>
    <Workbench page="multilingual" active={page === 'multilingual'} session={session} theme={theme} setTheme={setTheme}
      transfer={transfer} targetBusy={busy.conference} navigate={navigate} onAvailabilityChange={onAvailabilityChange}/>
  </>;
}

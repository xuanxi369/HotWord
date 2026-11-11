import { useCallback, useEffect, useRef, useState } from 'react';
import Workbench, { type WorkbenchPage, type WorkbenchTransfer } from './Workbench';
import { applyTheme, currentTheme } from './theme';
import { useWorkspaceSession } from './useWorkspaceSession';

const currentPage = (): WorkbenchPage => window.location.pathname.replace(/\/$/, '') === '/multilingual' ? 'multilingual' : 'conference';

export default function App() {
  const [page, setPage] = useState(currentPage);
  const [theme, setTheme] = useState(currentTheme);
  const [transfer, setTransfer] = useState<WorkbenchTransfer>();
  const transferId = useRef(0);
  const [busy, setBusy] = useState({ conference: false, multilingual: false });
  const session = useWorkspaceSession();
  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => {
    const restorePage = () => setPage(currentPage());
    window.addEventListener('popstate', restorePage);
    return () => window.removeEventListener('popstate', restorePage);
  }, []);
  const onAvailabilityChange = useCallback((target: WorkbenchPage, value: boolean) => {
    setBusy(current => current[target] === value ? current : { ...current, [target]: value });
  }, []);
  function navigate(target: WorkbenchPage, incoming?: Omit<WorkbenchTransfer, 'id' | 'page'>) {
    if (incoming) setTransfer({ ...incoming, page: target, id: ++transferId.current });
    if (currentPage() !== target) window.history.pushState(null, '', target === 'multilingual' ? '/multilingual' : '/');
    setPage(target);
  }
  return <>
    <Workbench page="conference" active={page === 'conference'} session={session} theme={theme} setTheme={setTheme}
      transfer={transfer} targetBusy={busy.multilingual} navigate={navigate} onAvailabilityChange={onAvailabilityChange}/>
    <Workbench page="multilingual" active={page === 'multilingual'} session={session} theme={theme} setTheme={setTheme}
      transfer={transfer} targetBusy={busy.conference} navigate={navigate} onAvailabilityChange={onAvailabilityChange}/>
  </>;
}

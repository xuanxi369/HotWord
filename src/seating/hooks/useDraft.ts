import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  draftStoreForOwner,
  createDraft,
  createDraftQueue,
  parseDraft,
  type Draft,
} from '../lib/drafts';
import { hasWorkspace, type Workspace } from '../lib/workspace';

export function useDraft(workspace: Workspace, restoreWorkspace: (workspace: Workspace) => void, owner?: string) {
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<Draft | null>(null);
  const [status, setStatus] = useState<'loading' | 'idle' | 'saving' | 'saved' | 'error'>(
    'loading',
  );
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState('');
  const [savedWorkspace, setSavedWorkspace] = useState<Workspace | null>(null);
  const store = useMemo(() => owner ? draftStoreForOwner(owner) : undefined, [owner]);
  const queue = useMemo(() => store ? createDraftQueue(store) : undefined, [store]);
  const sequence = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!store) return;
    let active = true;
    store
      .read()
      .then((value) => {
        if (!active) return;
        if (value) setPending(parseDraft(value));
        setStatus('idle');
      })
      .catch((failure: unknown) => {
        if (active) {
          setError(failure instanceof Error ? failure.message : '无法读取本机草稿。');
          setStatus('error');
        }
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [store]);

  const saveNow = useCallback(async () => {
    if (!queue || !ready || pending || !hasWorkspace(workspace)) return;
    const version = ++sequence.current;
    setStatus('saving');
    setError('');
    try {
      const draft = createDraft(workspace);
      await queue.write(draft);
      if (version === sequence.current) {
        setSavedWorkspace(workspace);
        setSavedAt(draft.savedAt);
        setStatus('saved');
      }
    } catch (failure) {
      if (version === sequence.current) {
        setStatus('error');
        setError(failure instanceof Error ? failure.message : '草稿保存失败，请先导出人员库。');
      }
    }
  }, [workspace, ready, pending, queue]);

  useEffect(() => {
    if (!ready || pending || !hasWorkspace(workspace) || workspace === savedWorkspace) return;
    ++sequence.current;
    setStatus('saving');
    const timer = setTimeout(() => {
      void saveNow();
    }, 500);
    saveTimer.current = timer;
    return () => {
      clearTimeout(timer);
    };
  }, [workspace, ready, pending, savedWorkspace, saveNow]);

  const needsLeaveWarning = hasWorkspace(workspace) && workspace !== savedWorkspace;
  useEffect(() => {
    if (!needsLeaveWarning) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [needsLeaveWarning]);

  const restore = useCallback(() => {
    if (!pending) return;
    restoreWorkspace(pending.workspace);
    setSavedWorkspace(pending.workspace);
    setSavedAt(pending.savedAt);
    setStatus('saved');
    setPending(null);
    setError('');
  }, [pending, restoreWorkspace]);

  const discard = useCallback(async () => {
    if (!queue) return false;
    clearTimeout(saveTimer.current);
    ++sequence.current;
    try {
      await queue.remove();
      setPending(null);
      setSavedWorkspace(null);
      setSavedAt('');
      setStatus('idle');
      setError('');
      return true;
    } catch {
      setStatus('error');
      setError('无法清除本机草稿，请检查浏览器存储设置。');
      return false;
    }
  }, [queue]);

  return {
    ready,
    pending,
    status,
    error,
    savedAt,
    needsLeaveWarning,
    saveNow,
    restore,
    discard,
  };
}

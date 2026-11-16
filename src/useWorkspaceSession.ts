import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { ModelSelection, ModelSettings } from '../shared/models';
import type { Job } from '../shared/schema';
import { initialModelSelection, readModelSelection, saveModelSelection, selectionForJob } from './model-selection';

type User = { email: string; local: boolean; role: 'admin' | 'member' };

/** Authentication and model selection are shared; each workbench keeps its own draft. */
export function useWorkspaceSession() {
  const [user, setUser] = useState<User>();
  const [userError, setUserError] = useState('');
  const [modelSettings, setModelSettings] = useState<ModelSettings>();
  const [selection, setSelection] = useState<ModelSelection>();
  const [selectionNotice, setSelectionNotice] = useState('');
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState('');
  const modelsRequest = useRef(0);
  const selectionInitialized = useRef(false);
  const userRef = useRef<User | undefined>(undefined);
  const settingsRef = useRef<ModelSettings | undefined>(undefined);
  const storage = () => { try { return globalThis.localStorage; } catch { return undefined; } };
  function selectModel(next: ModelSelection) {
    selectionInitialized.current = true;
    setSelection(next); setSelectionNotice('');
    if (userRef.current) saveModelSelection(storage(), userRef.current.email, next);
  }
  async function refreshModels() {
    const request = ++modelsRequest.current;
    setModelsLoading(true); setModelsError('');
    try {
      const next = await api<ModelSettings>('/api/models');
      if (request !== modelsRequest.current) return settingsRef.current;
      setModelSettings(next);
      settingsRef.current = next;
      if (!selectionInitialized.current) {
        const remembered = userRef.current ? readModelSelection(storage(), userRef.current.email) : undefined;
        const initial = initialModelSelection(next, remembered);
        selectionInitialized.current = true;
        setSelection(initial);
        if (remembered && !initial) setSelectionNotice('之前选择的 AI 服务已不可用，请重新选择模型与密钥');
      }
      return next;
    } catch (e) {
      if (request !== modelsRequest.current) return;
      settingsRef.current = undefined;
      setModelSettings(undefined); setModelsError((e as Error).message); throw e;
    }
    finally { if (request === modelsRequest.current) setModelsLoading(false); }
  }
  async function restoreJobSelection(job: Job) {
    const settings = settingsRef.current ?? await refreshModels();
    const restored = settings && selectionForJob(job, settings);
    if (restored) { selectModel(restored); return true; }
    selectionInitialized.current = true;
    setSelection(undefined);
    setSelectionNotice(`原任务使用的 ${job.service_name}（${job.model}）已不可用，请重新选择模型与密钥`);
    return false;
  }
  useEffect(() => {
    api<User>('/api/me').then(next => {
      userRef.current = next; setUser(next);
      refreshModels().catch(() => {});
    }).catch(e => setUserError(e.message));
  }, []);
  return { user, userError, modelSettings, selection, setSelection: selectModel, selectionNotice, modelsLoading, modelsError, refreshModels, restoreJobSelection };
}

export type WorkspaceSession = ReturnType<typeof useWorkspaceSession>;

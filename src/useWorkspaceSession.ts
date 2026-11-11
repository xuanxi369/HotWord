import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { ModelSelection, ModelSettings } from '../shared/models';

type User = { email: string; local: boolean; role: 'admin' | 'member' };

/** Authentication and model selection are shared; each workbench keeps its own draft. */
export function useWorkspaceSession() {
  const [user, setUser] = useState<User>();
  const [userError, setUserError] = useState('');
  const [modelSettings, setModelSettings] = useState<ModelSettings>();
  const [selection, setSelection] = useState<ModelSelection>();
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState('');
  const modelsRequest = useRef(0);
  async function refreshModels() {
    const request = ++modelsRequest.current;
    setModelsLoading(true); setModelsError('');
    try {
      const next = await api<ModelSettings>('/api/models');
      if (request !== modelsRequest.current) return;
      setModelSettings(next);
      setSelection(current => current ?? { mode: 'team', serviceId: next.services.find(s => s.ready)?.id ?? '' });
    } catch (e) {
      if (request !== modelsRequest.current) return;
      setModelSettings(undefined); setModelsError((e as Error).message); throw e;
    }
    finally { if (request === modelsRequest.current) setModelsLoading(false); }
  }
  useEffect(() => {
    api<User>('/api/me').then(setUser).catch(e => setUserError(e.message));
    refreshModels().catch(() => {});
  }, []);
  return { user, userError, modelSettings, selection, setSelection, modelsLoading, modelsError, refreshModels };
}

export type WorkspaceSession = ReturnType<typeof useWorkspaceSession>;

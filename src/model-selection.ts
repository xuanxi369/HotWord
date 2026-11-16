import { ModelSelectionSchema, type ModelSelection, type ModelSettings } from '../shared/models';
import type { Job } from '../shared/schema';

type SelectionStorage = Pick<Storage, 'getItem' | 'setItem'>;
const selectionKey = (email: string) => `hotword-ai-selection:${email.toLowerCase()}`;

export function readModelSelection(storage: SelectionStorage | undefined, email: string): ModelSelection | undefined {
  try {
    const raw = storage?.getItem(selectionKey(email));
    if (!raw) return undefined;
    const parsed = ModelSelectionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch { return undefined; }
}

export function saveModelSelection(storage: SelectionStorage | undefined, email: string, selection: ModelSelection) {
  const parsed = ModelSelectionSchema.safeParse(selection);
  if (!parsed.success) return;
  try { storage?.setItem(selectionKey(email), JSON.stringify(parsed.data)); } catch {}
}

export function selectionAvailable(selection: ModelSelection, settings: ModelSettings): boolean {
  return selection.mode === 'team'
    ? settings.services.some(service => service.id === selection.serviceId && service.ready)
    : settings.personalReady && settings.credentials.some(credential => credential.id === selection.credentialId);
}

export function initialModelSelection(settings: ModelSettings, remembered?: ModelSelection): ModelSelection | undefined {
  if (remembered) return selectionAvailable(remembered, settings) ? remembered : undefined;
  const service = settings.services.find(candidate => candidate.ready);
  return service ? { mode: 'team', serviceId: service.id } : undefined;
}

export function selectionForJob(job: Job, settings: ModelSettings): ModelSelection | undefined {
  if (job.mode === 'personal') {
    if (!job.credentialId) return undefined;
    const selection: ModelSelection = { mode: 'personal', credentialId: job.credentialId };
    const credential = settings.credentials.find(candidate => candidate.id === job.credentialId);
    return selectionAvailable(selection, settings) && credential?.config.provider === job.provider && credential.config.model === job.model ? selection : undefined;
  }
  const matches = settings.services.filter(service => service.ready && service.config.provider === job.provider && service.config.model === job.model);
  const service = matches.find(candidate => candidate.id === job.serviceId)
    ?? (!job.serviceId ? matches.find(candidate => candidate.name === job.service_name) ?? (matches.length === 1 ? matches[0] : undefined) : undefined);
  return service ? { mode: 'team', serviceId: service.id } : undefined;
}

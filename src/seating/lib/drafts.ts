import { z } from 'zod';
import { validateWorkspace, workspaceSchema, type Workspace } from './workspace';

const envelopeSchema = z
  .object({
    version: z.literal(1),
    savedAt: z.iso.datetime(),
    workspace: workspaceSchema,
  })
  .strict();
export type Draft = z.infer<typeof envelopeSchema>;
export interface DraftStore {
  read(): Promise<unknown>;
  write(draft: Draft): Promise<void>;
  remove(): Promise<void>;
}

export function createDraft(workspace: Workspace, now = new Date()): Draft {
  // Explicit allowlist: authentication, confirmation and transient UI state never enter storage.
  const {
    sheets,
    selectedSheets,
    excelName,
    imageName,
    image,
    plan,
    overrides,
    excluded,
    manualAssignments,
    notes,
    demo,
    resultModel,
  } = workspace;
  return {
    version: 1,
    savedAt: now.toISOString(),
    workspace: validateWorkspace({
      sheets,
      selectedSheets,
      excelName,
      imageName,
      image,
      plan,
      overrides,
      excluded,
      manualAssignments,
      notes,
      demo,
      resultModel,
    }),
  };
}
export function parseDraft(value: unknown): Draft {
  try {
    const draft = envelopeSchema.parse(value);
    return { ...draft, workspace: validateWorkspace(draft.workspace) };
  } catch {
    throw new Error('本机草稿格式无效或版本不兼容，请清除该草稿后重新整理。');
  }
}

let database: Promise<IDBDatabase> | undefined;
function openDatabase(): Promise<IDBDatabase> {
  if (!database)
    database = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('此浏览器无法保存本机草稿。'));
        return;
      }
      const request = indexedDB.open('hotword-seating-roster', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('drafts');
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('请关闭其他旧版本页面后重试保存草稿。'));
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close();
          database = undefined;
        };
        resolve(request.result);
      };
    }).catch((error: unknown) => {
      database = undefined;
      throw error;
    });
  return database;
}
async function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction('drafts', mode);
    const request = action(tx.objectStore('drafts'));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error || new Error('草稿保存被中断。'));
    tx.onerror = () => reject(tx.error || new Error('草稿存储空间不足或不可用。'));
  });
}
export const browserDraftStore: DraftStore = {
  read: () => transaction('readonly', (store) => store.get('current')),
  write: async (draft) => {
    await transaction('readwrite', (store) => store.put(draft, 'current'));
  },
  remove: async () => {
    await transaction('readwrite', (store) => store.delete('current'));
  },
};

// Access identities share the same origin; each member gets a separate local draft.
export function draftStoreForOwner(owner: string): DraftStore {
  const key = `member:${owner.toLowerCase()}`;
  return {
    read: () => transaction('readonly', store => store.get(key)),
    write: async draft => { await transaction('readwrite', store => store.put(draft, key)); },
    remove: async () => { await transaction('readwrite', store => store.delete(key)); },
  };
}

// Serial writes prevent a slow older save from replacing newer work or resurrecting a cleared draft.
export function createDraftQueue(store: DraftStore) {
  let previous = Promise.resolve();
  function enqueue(action: () => Promise<void>) {
    const next = previous.then(action);
    previous = next.catch(() => {});
    return next;
  }
  return {
    write: (draft: Draft) => enqueue(() => store.write(draft)),
    remove: () => enqueue(() => store.remove()),
  };
}

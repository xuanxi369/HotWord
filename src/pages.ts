export type WorkspacePage = 'conference' | 'multilingual' | 'seating';
export const workspacePaths: Record<WorkspacePage, string> = { conference: '/', multilingual: '/multilingual', seating: '/seating' };
export function pageForPath(path: string): WorkspacePage {
  const normalized = path.replace(/\/$/, '');
  return normalized === '/seating' ? 'seating' : normalized === '/multilingual' ? 'multilingual' : 'conference';
}

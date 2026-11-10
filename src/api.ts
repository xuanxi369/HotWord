export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  if (!response.headers.get('Content-Type')?.includes('application/json')) throw new Error('登录可能已过期，请刷新页面后重新登录');
  const data = await response.json() as { error?: string };
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data as T;
}

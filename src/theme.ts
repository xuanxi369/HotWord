export type Theme = 'light' | 'dark';
export function currentTheme(): Theme { return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'; }
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#18191a' : '#f7f8f6');
  try { localStorage.setItem('hotword-theme', theme); } catch {}
}

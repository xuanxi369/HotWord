(() => {
  let theme;
  try { theme = localStorage.getItem('hotword-theme'); } catch {}
  document.documentElement.dataset.theme = theme === 'light' || theme === 'dark' ? theme : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
})();

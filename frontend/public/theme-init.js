(() => {
  let choice = 'system';
  try { choice = localStorage.getItem('sitedock.theme') || 'system'; } catch {}
  const theme = choice === 'light' || choice === 'dark' ? choice : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  // The status bar takes theme-color, so it matches the header (--panel) rather than the page background.
  document.documentElement.style.backgroundColor = theme === 'dark' ? '#0f172a' : '#ffffff';
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#0f172a' : '#ffffff';
})();

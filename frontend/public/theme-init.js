(() => {
  let choice = 'midnight';
  try { choice = localStorage.getItem('sitedock.theme') || 'midnight'; } catch {}
  const theme = choice === 'light' || (choice === 'system' && !matchMedia('(prefers-color-scheme: dark)').matches) ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle('light', theme === 'light');
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.classList.toggle('theme-midnight', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
  // The status bar takes theme-color, so it matches the header (--panel) rather than the page background.
  document.documentElement.style.backgroundColor = theme === 'dark' ? '#0f172a' : '#ffffff';
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#0f172a' : '#ffffff';
})();

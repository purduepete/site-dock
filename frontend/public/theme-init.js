(() => {
  let choice = 'system';
  try { choice = localStorage.getItem('sitedock.theme') || 'system'; } catch {}
  const theme = choice === 'light' || choice === 'dark' ? choice : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.backgroundColor = theme === 'dark' ? '#020617' : '#f4f5fb';
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#020617' : '#f4f5fb';
})();

(() => {
    let choice = '';
    try {
        choice = localStorage.getItem('sitedock.theme') || '';
    } catch {}
    // Safari can purge localStorage; the server-set preferences cookie keeps the choice.
    try {
        const raw = document.cookie
            .split(';')
            .map((part) => part.trim())
            .find((part) => /^(?:__Host-)?sitedock-prefs=/.test(part));
        if (!choice && raw) choice = JSON.parse(decodeURIComponent(raw.slice(raw.indexOf('=') + 1))).theme || '';
    } catch {}
    choice = choice || 'midnight';
    const theme =
        choice === 'light' || (choice === 'system' && !matchMedia('(prefers-color-scheme: dark)').matches)
            ? 'light'
            : 'dark';
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle('light', theme === 'light');
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.classList.toggle('theme-midnight', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
    // The status bar takes theme-color, so it matches the header (--panel) rather than the page background.
    document.documentElement.style.backgroundColor = theme === 'dark' ? '#0f172a' : '#ffffff';
    document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#0f172a' : '#ffffff';
    // iOS saves whichever site icon is linked when the app is added to the home screen.
    const siteIcon = document.querySelector('link[rel="apple-touch-icon"]');
    if (siteIcon) siteIcon.href = theme === 'dark' ? '/apple-touch-icon.png?v=2' : '/apple-touch-icon-light.png?v=2';
})();

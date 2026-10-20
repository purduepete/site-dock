import { useEffect, useState } from 'react';
import { readPreference, savePreference, type Theme } from './model';

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = readPreference('theme', 'midnight');
    return saved === 'light' || saved === 'system' ? saved : 'midnight';
  });
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = theme === 'system' ? media.matches ? 'dark' : 'light' : theme === 'midnight' ? 'dark' : 'light';
      document.documentElement.dataset.theme = resolved;
      document.documentElement.classList.toggle('light', resolved === 'light');
      document.documentElement.classList.toggle('dark', resolved === 'dark');
      document.documentElement.classList.toggle('theme-midnight', resolved === 'dark');
      document.documentElement.style.colorScheme = resolved;
      document.documentElement.style.backgroundColor = resolved === 'dark' ? '#0f172a' : '#ffffff';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#0f172a' : '#ffffff');
    };
    savePreference('theme', theme);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  return [theme, setTheme] as const;
}

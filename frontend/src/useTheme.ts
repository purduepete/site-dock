import { useEffect, useState } from 'react';
import { readPreference, savePreference, type Theme } from './model';

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = readPreference('theme', 'system');
    return saved === 'dark' || saved === 'light' ? saved : 'system';
  });
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = theme === 'system' ? media.matches ? 'dark' : 'light' : theme;
      document.documentElement.dataset.theme = resolved;
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

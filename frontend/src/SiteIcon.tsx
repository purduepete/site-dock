import { useState } from 'react';

const iconPaths = ['/favicon.svg', '/favicon.ico', '/apple-touch-icon.png', '/icons/icon-192.png'];

export function SiteIcon({ url, name }: { url: string; name: string }) {
  const [attempt, setAttempt] = useState(0);
  const source = new URL(iconPaths[Math.min(attempt, iconPaths.length - 1)], url);
  const blocked = location.protocol === 'https:' && source.protocol === 'http:';
  return <span className="site-icon" aria-hidden="true">
    {attempt < iconPaths.length && !blocked ? <img key={source.href} src={source.href} alt="" referrerPolicy="no-referrer"
      onError={() => setAttempt(value => value + 1)} /> : <span className="site-monogram">{name.trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join('').toUpperCase()}</span>}
  </span>;
}

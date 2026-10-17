import { useState } from 'react';

const iconPaths = ['/favicon.svg', '/favicon.ico', '/apple-touch-icon.png', '/icons/icon-192.png'];
const storeKey = 'sitedock.icons';
const day = 86_400_000;
// A found icon is trusted for a week; "no icon" is retried after a day in case the site adds one.
const foundFor = 7 * day;
const missingFor = day;

type Entry = { src: string | null; at: number };
let entries: Record<string, Entry> | null = null;
// Holding each loaded image keeps it in the page's image cache, so remounting an icon after a
// group switch reuses it instead of asking the site again.
const loaded = new Map<string, HTMLImageElement>();

function cache(): Record<string, Entry> {
  if (entries) return entries;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storeKey) ?? '{}');
    entries = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, Entry> : {};
  } catch { entries = {}; }
  return entries;
}

function known(origin: string): string | null | undefined {
  const entry = cache()[origin];
  if (!entry || typeof entry.at !== 'number' || (entry.src !== null && typeof entry.src !== 'string')) return undefined;
  if (entry.src !== null && !entry.src.startsWith(`${origin}/`)) return undefined;
  return Date.now() - entry.at < (entry.src ? foundFor : missingFor) ? entry.src : undefined;
}

function keep(src: string) {
  if (loaded.has(src)) return;
  const image = new Image();
  image.referrerPolicy = 'no-referrer';
  image.src = src;
  loaded.set(src, image);
}

function remember(origin: string, src: string | null) {
  const all = cache();
  all[origin] = { src, at: Date.now() };
  try { localStorage.setItem(storeKey, JSON.stringify(all)); } catch { /* the in-memory copy still applies */ }
}

type Candidates = { origin: string; sources: string[] };

function candidates(url: string): Candidates | null {
  let base: URL;
  try { base = new URL(url); } catch { return null; }
  if (location.protocol === 'https:' && base.protocol === 'http:') return null;
  const all = iconPaths.map(path => new URL(path, base).href);
  const cached = known(base.origin);
  if (cached === null) return { origin: base.origin, sources: [] };
  return { origin: base.origin, sources: cached ? [cached, ...all.filter(src => src !== cached)] : all };
}

export function SiteIcon({ url, name }: { url: string; name: string }) {
  const [state, setState] = useState(() => ({ url, attempt: 0, list: candidates(url) }));
  if (state.url !== url) setState({ url, attempt: 0, list: candidates(url) });
  const { list, attempt } = state;
  const source = state.url === url ? list?.sources[attempt] : undefined;
  return <span className="site-icon" aria-hidden="true">
    {source && list ? <img key={source} src={source} alt="" referrerPolicy="no-referrer"
      onLoad={() => { keep(source); if (known(list.origin) !== source) remember(list.origin, source); }}
      onError={() => {
        if (attempt + 1 >= list.sources.length) remember(list.origin, null);
        setState(value => value.url === url ? { ...value, attempt: value.attempt + 1 } : value);
      }} /> : <span className="site-monogram">{name.trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join('').toUpperCase()}</span>}
  </span>;
}

export function resetIconCache() { entries = null; loaded.clear(); }

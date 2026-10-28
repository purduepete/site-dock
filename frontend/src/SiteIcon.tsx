import { useState } from 'react';

const iconPaths = ['/favicon.svg', '/favicon.ico', '/apple-touch-icon.png', '/icons/icon-192.png'];
const storeKey = 'sitedock.icons';
const day = 86_400_000;
// A found icon is trusted for a week. "No icon" is kept in memory only: before a Cloudflare Access
// sign-in every icon request fails, so saving that result would hide icons after sign-in.
const foundFor = 7 * day;

type Entry = { src: string | null; at: number };
let entries: Record<string, Entry> | null = null;
let pageLoad = crypto.randomUUID();
// Holding each loaded image keeps it in the page's image cache, so remounting an icon after a
// group switch reuses it instead of asking the site again.
const loaded = new Map<string, HTMLImageElement>();

function cache(): Record<string, Entry> {
    if (entries) return entries;
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(storeKey) ?? '{}');
        entries =
            parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, Entry>) : {};
    } catch {
        entries = {};
    }
    for (const origin of Object.keys(entries)) if (entries[origin]?.src === null) delete entries[origin];
    return entries;
}

function known(origin: string): string | null | undefined {
    const entry = cache()[origin];
    if (!entry || typeof entry.at !== 'number' || (entry.src !== null && typeof entry.src !== 'string'))
        return undefined;
    if (entry.src !== null && !entry.src.startsWith(`${origin}/`)) return undefined;
    if (entry.src === null) return null;
    return Date.now() - entry.at < foundFor ? entry.src : undefined;
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
    const found = Object.fromEntries(Object.entries(all).filter(([, entry]) => entry.src !== null));
    try {
        localStorage.setItem(storeKey, JSON.stringify(found));
    } catch {
        /* the in-memory copy still applies */
    }
}

// Lets icons that failed before a sign-in try again.
export function forgetMissingIcons() {
    const all = cache();
    for (const origin of Object.keys(all)) if (all[origin].src === null) delete all[origin];
}

type Candidates = { origin: string; sources: string[] };

function candidates(url: string): Candidates | null {
    let base: URL;
    try {
        base = new URL(url);
    } catch {
        return null;
    }
    if (location.protocol === 'https:' && base.protocol === 'http:') return null;
    const all = iconPaths.map((path) => new URL(path, base).href);
    const cached = known(base.origin);
    if (cached === null) return { origin: base.origin, sources: [] };
    return { origin: base.origin, sources: cached ? [cached, ...all.filter((src) => src !== cached)] : all };
}

export function SiteIcon({ url, name }: { url: string; name: string }) {
    const [state, setState] = useState(() => ({ url, attempt: 0, list: candidates(url) }));
    if (state.url !== url) setState({ url, attempt: 0, list: candidates(url) });
    const { list, attempt } = state;
    const source = state.url === url ? list?.sources[attempt] : undefined;
    const imageSource = source ? new URL(source) : null;
    imageSource?.searchParams.set('_sitedock', pageLoad);
    return (
        <span className="site-icon" aria-hidden="true">
            {source && imageSource && list ? (
                <img
                    key={source}
                    src={imageSource.href}
                    alt=""
                    referrerPolicy="no-referrer"
                    onLoad={() => {
                        keep(imageSource.href);
                        if (known(list.origin) !== source) remember(list.origin, source);
                    }}
                    onError={() => {
                        if (attempt + 1 >= list.sources.length) remember(list.origin, null);
                        setState((value) => (value.url === url ? { ...value, attempt: value.attempt + 1 } : value));
                    }}
                />
            ) : (
                <span className="site-monogram">
                    {name
                        .trim()
                        .split(/\s+/)
                        .slice(0, 2)
                        .map((word) => Array.from(word)[0])
                        .join('')
                        .toUpperCase()}
                </span>
            )}
        </span>
    );
}

export function resetIconCache() {
    entries = null;
    loaded.clear();
    pageLoad = crypto.randomUUID();
}

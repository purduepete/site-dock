export type Favorite = { id: string; name: string; url: string; mode: 'embed' | 'external'; groups?: string[] };
export type Store = { revision: number; favorites: Favorite[]; groups?: string[] };
export type Session = { authenticated: boolean; username?: string; allowedOrigins?: string[]; gatewayAuthenticated?: boolean };
export type Theme = 'dark' | 'light' | 'system';

export function readPreference(key: string, fallback = ''): string {
  try { return localStorage.getItem(`sitedock.${key}`) ?? fallback; } catch { return fallback; }
}

export function savePreference(key: string, value: string): void {
  try { localStorage.setItem(`sitedock.${key}`, value); } catch { /* Private browsing may disable storage. */ }
}

export function validateUrl(value: string, ownOrigins: string[] = [location.origin]): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('Enter a complete http:// or https:// address.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS addresses are supported.');
  if (url.username || url.password) throw new Error('Addresses cannot include a username or password.');
  if (ownOrigins.includes(url.origin)) throw new Error('SiteDock cannot be added to its own favorites.');
  return url.href;
}

export function isExternal(favorite: Favorite, protocol = location.protocol): boolean {
  return favorite.mode === 'external' || (protocol === 'https:' && new URL(favorite.url).protocol === 'http:');
}

export function moveFavorite(favorites: Favorite[], id: string, target: number): Favorite[] {
  const index = favorites.findIndex(favorite => favorite.id === id);
  if (index < 0 || target < 0 || target >= favorites.length || index === target) return favorites;
  const next = [...favorites];
  const [favorite] = next.splice(index, 1);
  next.splice(target, 0, favorite);
  return next;
}

export const GROUP_LIMIT = 10;

/** Alt+1..9 for the first 9 sites and Alt+0 for the 10th. */
export function shortcutKey(index: number): string | null {
  return index >= 0 && index < 9 ? String(index + 1) : index === 9 ? '0' : null;
}

export function groupCounts(favorites: readonly Favorite[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const favorite of favorites) for (const group of favorite.groups ?? []) counts.set(group, (counts.get(group) ?? 0) + 1);
  return counts;
}

// Groups saved above the limit before it existed keep their sites but cannot grow.
export function groupCapViolation(next: readonly Favorite[], committed: readonly Favorite[]): string | null {
  const before = groupCounts(committed);
  for (const [group, count] of groupCounts(next)) if (count > GROUP_LIMIT && count > (before.get(group) ?? 0)) return group;
  return null;
}

export function clampWidth(width: number): number {
  return Math.max(220, Math.min(480, Number.isFinite(width) ? width : 280));
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public store?: Store) { super(message); }
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? 'GET' : path === 'favorites' ? 'PUT' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const store = data.current ?? data;
    throw new ApiError(response.status, typeof data.error === 'string' ? data.error : `Request failed (${response.status}).`,
      typeof store.revision === 'number' && Array.isArray(store.favorites) ? store : undefined);
  }
  return data as T;
}

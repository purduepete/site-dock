// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPreference, savePreference } from './model';

let values: Map<string, string>;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
    vi.useFakeTimers();
    values = new Map();
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
    });
    fetchMock = vi.fn(async () => new Response('{"ok":true}'));
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
    document.cookie = 'sitedock-prefs=; Max-Age=0';
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('preferences', () => {
    it('reads the server-set cookie when Safari has purged localStorage', () => {
        document.cookie = `sitedock-prefs=${encodeURIComponent('{"group":"group:Sports","width":"320"}')}`;
        expect(readPreference('group', 'all')).toBe('group:Sports');
        expect(readPreference('width')).toBe('320');
        values.set('sitedock.group', 'group:News');
        expect(readPreference('group', 'all')).toBe('group:News');
        expect(readPreference('theme', 'midnight')).toBe('midnight');
    });

    it('merges a burst of saves with existing values into one cookie update', async () => {
        values.set('sitedock.theme', 'light');
        savePreference('width', '300');
        savePreference('width', '310');
        savePreference('sidebar-minimized', 'true');
        await vi.advanceTimersByTimeAsync(300);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [path, options] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(path).toBe('/api/preferences');
        expect(options.method).toBe('POST');
        expect(JSON.parse(String(options.body))).toEqual({ theme: 'light', width: '310', 'sidebar-minimized': 'true' });
        savePreference('width', '310');
        await vi.advanceTimersByTimeAsync(300);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(values.get('sitedock.width')).toBe('310');
    });
});

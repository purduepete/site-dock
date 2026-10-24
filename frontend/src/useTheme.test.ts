// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import source from '../public/theme-init.js?raw';
import { useTheme } from './useTheme';

let media: MediaQueryList;
let listeners: Set<() => void>;
let values: Map<string, string>;
beforeEach(() => {
    values = new Map();
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
    });
    listeners = new Set();
    media = {
        matches: false,
        addEventListener: (_: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    } as unknown as MediaQueryList;
    vi.stubGlobal('matchMedia', () => media);
    document.head.innerHTML = '<meta name="theme-color" content="">';
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});
function os(dark: boolean) {
    Object.defineProperty(media, 'matches', { value: dark, configurable: true });
    act(() => listeners.forEach((listener) => listener()));
}
function expectTheme(dark: boolean) {
    expect(document.documentElement.dataset.theme).toBe(dark ? 'dark' : 'light');
    expect(document.documentElement.style.colorScheme).toBe(dark ? 'dark' : 'light');
    expect(document.documentElement.classList.contains('theme-midnight')).toBe(dark);
    expect(document.querySelector('meta')?.content).toBe(dark ? '#0f172a' : '#ffffff');
}
describe('theme preference', () => {
    it.each([null, 'dark', 'midnight', 'light', 'system', 'invalid'])(
        'keeps prepaint/runtime coherent for %s',
        (saved) => {
            if (saved) values.set('sitedock.theme', saved);
            new Function(source)();
            expectTheme(saved !== 'light' && saved !== 'system');
            const { result } = renderHook(useTheme);
            expectTheme(saved !== 'light' && saved !== 'system');
            expect(result.current[0]).toBe(saved === 'light' || saved === 'system' ? saved : 'midnight');
        }
    );
    it('falls back to the server-set cookie after Safari purges localStorage', () => {
        document.cookie = `sitedock-prefs=${encodeURIComponent('{"theme":"light"}')}`;
        try {
            new Function(source)();
            expectTheme(false);
            const { result } = renderHook(useTheme);
            expect(result.current[0]).toBe('light');
        } finally {
            document.cookie = 'sitedock-prefs=; Max-Age=0';
        }
    });
    it('tracks OS only in system mode and supports reselecting it', () => {
        const { result, unmount } = renderHook(useTheme);
        act(() => result.current[1]('system'));
        expectTheme(false);
        os(true);
        expectTheme(true);
        act(() => result.current[1]('light'));
        os(false);
        os(true);
        expectTheme(false);
        act(() => result.current[1]('midnight'));
        os(false);
        expectTheme(true);
        act(() => result.current[1]('system'));
        expectTheme(false);
        expect(values.get('sitedock.theme')).toBe('system');
        unmount();
        expect(listeners.size).toBe(0);
    });
});

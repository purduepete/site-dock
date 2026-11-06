// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import source from '../public/theme-init.js?raw';
import favicon from '../public/favicon.svg?raw';
import lightSource from '../public/apple-touch-icon-light.svg?raw';
import brandLight from '../public/brand-light.svg?raw';
import darkPng from '../public/apple-touch-icon.png?inline';
import lightPng from '../public/apple-touch-icon-light.png?inline';
import { SITE_ICONS, useTheme } from './useTheme';

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
    document.head.innerHTML =
        '<meta name="theme-color" content=""><link rel="apple-touch-icon" href="/apple-touch-icon.png?v=2">';
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
    expect(document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href')).toBe(
        dark ? SITE_ICONS.dark : SITE_ICONS.light
    );
}
// Width and height from a PNG data URL's IHDR chunk (bytes 16-23).
function pngSize(dataUrl: string) {
    const bytes = atob(dataUrl.split(',')[1]);
    const word = (at: number) => [0, 1, 2, 3].reduce((n, i) => n * 256 + bytes.charCodeAt(at + i), 0);
    return [word(16), word(20)];
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
    it('ships a dark favicon and 180px light and dark site icons', () => {
        expect(favicon).toContain('<rect x="4" y="4" width="56" height="56" rx="14" fill="#0f172a" />');
        expect(favicon).toContain('stroke="#38bdf8"');
        expect(lightSource).toContain('<rect width="64" height="64" fill="#fff7ed" />');
        expect(brandLight).toContain('<rect x="4" y="4" width="56" height="56" rx="14" fill="#fff7ed" />');
        expect(brandLight).toContain('stroke="#0284c7"');
        expect(source).toContain(SITE_ICONS.dark);
        expect(source).toContain(SITE_ICONS.light);
        expect(pngSize(darkPng)).toEqual([180, 180]);
        expect(pngSize(lightPng)).toEqual([180, 180]);
    });
});

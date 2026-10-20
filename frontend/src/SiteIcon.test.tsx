import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { forgetMissingIcons, resetIconCache, SiteIcon } from './SiteIcon';

let stored: Map<string, string>;
beforeEach(() => {
    stored = new Map();
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => {
            stored.set(key, value);
        },
        removeItem: (key: string) => {
            stored.delete(key);
        },
    });
    resetIconCache();
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

const src = (container: HTMLElement) => container.querySelector('img')?.getAttribute('src') ?? null;

it('tries site favicon formats directly without a referrer and falls back to circular initials', () => {
    const { container } = render(<SiteIcon url="https://example.com/path" name="Example Site" />);
    const image = container.querySelector('img')!;
    expect(image.getAttribute('src')).toBe('https://example.com/favicon.svg');
    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer');
    fireEvent.error(image);
    expect(src(container)).toBe('https://example.com/favicon.ico');
    for (let index = 0; index < 3; index++) fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.site-monogram')?.textContent).toBe('ES');
});

it('uses circular initials without making mixed-content image requests', () => {
    vi.stubGlobal('location', { protocol: 'https:' });
    const { container } = render(<SiteIcon url="http://example.com/" name="Ferry Tracker" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.site-monogram')?.textContent).toBe('FT');
});

it('remembers the icon that loaded, so a remount skips the paths that failed', () => {
    const first = render(<SiteIcon url="https://example.com/" name="Example" />);
    fireEvent.error(first.container.querySelector('img')!);
    fireEvent.error(first.container.querySelector('img')!);
    expect(src(first.container)).toBe('https://example.com/apple-touch-icon.png');
    fireEvent.load(first.container.querySelector('img')!);
    first.unmount();
    const second = render(<SiteIcon url="https://example.com/other" name="Example" />);
    expect(src(second.container)).toBe('https://example.com/apple-touch-icon.png');
    resetIconCache();
    const reloaded = render(<SiteIcon url="https://example.com/" name="Example" />);
    expect(src(reloaded.container)).toBe('https://example.com/apple-touch-icon.png');
});

it('keeps "no icon" for this session only and retries after a sign-in', () => {
    const first = render(<SiteIcon url="https://example.com/" name="Example" />);
    for (let index = 0; index < 4; index++) fireEvent.error(first.container.querySelector('img')!);
    first.unmount();
    const again = render(<SiteIcon url="https://example.com/" name="Example" />);
    expect(again.container.querySelector('img')).toBeNull();
    again.unmount();
    expect(stored.get('sitedock.icons') ?? '{}').toBe('{}');
    forgetMissingIcons();
    const retried = render(<SiteIcon url="https://example.com/" name="Example" />);
    expect(src(retried.container)).toBe('https://example.com/favicon.svg');
    retried.unmount();
    stored.set('sitedock.icons', JSON.stringify({ 'https://example.com': { src: null, at: Date.now() } }));
    resetIconCache();
    const launched = render(<SiteIcon url="https://example.com/" name="Example" />);
    expect(src(launched.container)).toBe('https://example.com/favicon.svg');
});

it('falls back through the other paths when a remembered icon stops loading', () => {
    stored.set(
        'sitedock.icons',
        JSON.stringify({ 'https://example.com': { src: 'https://example.com/favicon.ico', at: Date.now() } })
    );
    const { container } = render(<SiteIcon url="https://example.com/" name="Example" />);
    expect(src(container)).toBe('https://example.com/favicon.ico');
    fireEvent.error(container.querySelector('img')!);
    expect(src(container)).toBe('https://example.com/favicon.svg');
});

it('ignores a stored icon from another origin', () => {
    stored.set(
        'sitedock.icons',
        JSON.stringify({ 'https://example.com': { src: 'https://evil.example/x.png', at: Date.now() } })
    );
    const { container } = render(<SiteIcon url="https://example.com/" name="Example" />);
    expect(src(container)).toBe('https://example.com/favicon.svg');
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import type { Favorite } from './model';

const favorites: Favorite[] = [
    { id: 'one', name: 'Example', url: 'https://example.com/', mode: 'embed' },
    { id: 'two', name: 'Other', url: 'https://example.org/', mode: 'embed' },
    { id: 'three', name: 'News', url: 'https://news.example.com/', mode: 'external' },
];
let authenticated: boolean;
let gatewayAuthenticated: boolean;
let revision: number;
let data: Favorite[];
let conflict: boolean;
let requests: Array<{ path: string; body?: Record<string, unknown> }>;
let failSave: boolean;
let groupNames: string[];
let hiddenGroupNames: string[];
let conflictStore: { revision: number; favorites: Favorite[]; groups: string[] } | null;
const sites = (count: number, groups?: string[], start = 1): Favorite[] =>
    Array.from({ length: count }, (_, offset) => {
        const n = start + offset;
        return {
            id: `s${n}`,
            name: `Site ${n}`,
            url: `https://s${n}.example.com/`,
            mode: 'embed',
            ...(groups ? { groups } : {}),
        };
    });

beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function () {
        this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = function () {
        this.removeAttribute('open');
    };
    authenticated = true;
    gatewayAuthenticated = false;
    revision = 1;
    data = favorites.map((item) => ({ ...item }));
    conflict = false;
    failSave = false;
    requests = [];
    groupNames = [];
    hiddenGroupNames = [];
    conflictStore = null;
    const preferences = new Map<string, string>();
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => preferences.get(key) ?? null,
        setItem: (key: string, value: string) => preferences.set(key, value),
        removeItem: (key: string) => preferences.delete(key),
        clear: () => preferences.clear(),
    });
    vi.stubGlobal(
        'matchMedia',
        vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    );
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string, options: RequestInit) => {
            const body = options.body ? (JSON.parse(String(options.body)) as Record<string, unknown>) : undefined;
            requests.push({ path: input, body });
            let value: unknown = {};
            let status = 200;
            if (input === '/api/session')
                value = {
                    authenticated,
                    username: 'owner',
                    gatewayAuthenticated,
                    allowedOrigins: ['https://dock.example.com'],
                };
            if (input === '/api/login') {
                authenticated = true;
                value = { authenticated: true };
            }
            if (input === '/api/logout') {
                authenticated = false;
            }
            if (input === '/api/favorites') {
                if (!authenticated) {
                    status = 401;
                    value = { error: 'Session expired' };
                } else if (body && conflict) {
                    status = 409;
                    value = conflictStore
                        ? { ...conflictStore, error: 'Conflict' }
                        : {
                              revision: 7,
                              favorites: [{ ...favorites[0], name: 'Changed elsewhere' }],
                              groups: ['News'],
                              hiddenGroups: [],
                              error: 'Conflict',
                          };
                } else if (body && failSave) {
                    status = 500;
                    value = { error: 'Disk unavailable' };
                } else {
                    if (body) {
                        data = body.favorites as Favorite[];
                        groupNames = body.groups as string[];
                        hiddenGroupNames = (body.hiddenGroups as string[] | undefined) ?? [];
                        revision++;
                    }
                    value = { revision, favorites: data, groups: groupNames, hiddenGroups: hiddenGroupNames };
                }
            }
            return new Response(JSON.stringify(value), { status });
        })
    );
});
afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});
async function ready() {
    render(<App />);
    expect(document.querySelector('[data-first-load]')?.getAttribute('data-first-load')).toBe('loading');
    await screen.findByTitle('Example');
}

describe('startup loading', () => {
    it('keeps one continuous indicator across session and favorites requests', async () => {
        const fetchFixture = fetch;
        vi.useFakeTimers();
        vi.stubGlobal(
            'fetch',
            vi.fn(async (...args: Parameters<typeof fetch>) => {
                if (args[0] === '/api/session' || args[0] === '/api/favorites') {
                    await new Promise((resolve) => setTimeout(resolve, 150));
                }
                return fetchFixture(...args);
            })
        );
        render(<App />);
        expect(screen.queryByRole('textbox', { name: /username/i })).toBeNull();
        await act(() => vi.advanceTimersByTimeAsync(150));
        expect(screen.queryByRole('status', { name: 'Loading Site Dock' })).toBeNull();
        await act(() => vi.advanceTimersByTimeAsync(100));
        const indicator = screen.getByRole('status', { name: 'Loading Site Dock' });
        expect(document.querySelector('[data-first-load]')?.getAttribute('data-first-load')).toBe('loading');
        await act(() => vi.advanceTimersByTimeAsync(49));
        expect(screen.getByRole('status', { name: 'Loading Site Dock' })).toBe(indicator);
        await act(() => vi.advanceTimersByTimeAsync(1));
        expect(screen.queryByRole('status', { name: 'Loading Site Dock' })).toBeNull();
        expect(document.querySelector('[data-first-load]')?.getAttribute('data-first-load')).toBe('ready');
        const frame = screen.getByTitle('Example');
        expect(frame.closest('.initial-content')).toBeNull();
    });

    it('stops loading after session failure without flashing login and supports retry', async () => {
        const fetchFixture = fetch;
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection unavailable')));
        render(<App />);
        expect((await screen.findByRole('alert')).textContent).toContain('Could not check your session');
        expect(screen.queryByRole('status', { name: 'Loading Site Dock' })).toBeNull();
        expect(screen.queryByRole('textbox', { name: /username/i })).toBeNull();
        vi.stubGlobal('fetch', fetchFixture);
        await userEvent.click(screen.getByRole('button', { name: 'Retry connection' }));
        await screen.findByTitle('Example');
    });

    it('stops loading after favorites failure, keeps navigation, and retries empty results once', async () => {
        const fetchFixture = fetch;
        vi.stubGlobal(
            'fetch',
            vi.fn(async (...args: Parameters<typeof fetch>) => {
                if (args[0] === '/api/favorites') throw new Error('Favorites unavailable');
                return fetchFixture(...args);
            })
        );
        render(<App />);
        expect((await screen.findByRole('alert')).textContent).toContain('Could not load favorites');
        expect(screen.queryByRole('status', { name: 'Loading Site Dock' })).toBeNull();
        expect(screen.queryByText('Your sites start here.')).toBeNull();
        const sidebar = screen.getByRole('complementary', { name: 'Favorites' });
        data = [];
        vi.stubGlobal('fetch', fetchFixture);
        await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
        const heading = await screen.findByText('Your sites start here.');
        expect(heading.closest('.initial-content')).toBeTruthy();
        fireEvent.animationEnd(heading.closest('section')!);
        fireEvent(window, new Event('focus'));
        await waitFor(() => expect(requests.filter(({ path }) => path === '/api/session')).toHaveLength(2));
        expect(screen.getByRole('complementary', { name: 'Favorites' })).toBe(sidebar);
        expect(heading.closest('.initial-content')).toBeNull();
    });

    it('returns to login without a stuck spinner when initial favorites returns 401', async () => {
        const fetchFixture = fetch;
        vi.stubGlobal(
            'fetch',
            vi.fn(async (...args: Parameters<typeof fetch>) => {
                if (args[0] === '/api/favorites') {
                    return new Response(JSON.stringify({ error: 'Session expired' }), { status: 401 });
                }
                return fetchFixture(...args);
            })
        );
        render(<App />);
        await screen.findByRole('textbox', { name: /username/i });
        expect(screen.getByRole('alert').textContent).toContain('Your session ended');
        expect(screen.queryByRole('status', { name: 'Loading Site Dock' })).toBeNull();
        expect(document.querySelector('iframe')).toBeNull();
    });
});

describe('dashboard sessions and embedded pages', () => {
    it('does not show tooltips in the dashboard or favorite editor', async () => {
        await ready();
        const group = screen.getByRole('combobox', { name: 'Group' });
        const example = screen.getByRole('button', { name: 'Example' });
        const external = screen.getByRole('link', { name: 'Open News in a separate tab' });
        const sidebarToggle = screen.getByRole('button', { name: 'Minimize favorites' });
        const signOut = screen.getByRole('button', { name: 'Sign out' });
        const reload = screen.getByRole('button', { name: 'Reload selected site' });
        expect(group.getAttribute('aria-describedby')).toBeNull();
        expect(example.getAttribute('aria-describedby')).toBeNull();
        expect(external.getAttribute('aria-describedby')).toBeNull();
        expect(sidebarToggle.getAttribute('aria-describedby')).toBeNull();
        expect(signOut.getAttribute('aria-describedby')).toBeNull();

        for (const control of [
            group,
            example,
            external,
            sidebarToggle,
            signOut,
            reload,
            screen.getByRole('button', { name: 'Move Example down' }),
            screen.getByRole('button', { name: 'Edit Example' }),
            screen.getByRole('button', { name: 'Delete Example' }),
        ]) {
            await userEvent.hover(control);
            expect(screen.queryByRole('tooltip')).toBeNull();
        }

        await userEvent.click(screen.getByRole('button', { name: 'Edit Example' }));
        expect(screen.queryByRole('button', { name: 'Group membership information' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Opening sites information' })).toBeNull();
    });

    it('edits in a modal, keeps its dropdown inside, and returns focus on cancel', async () => {
        await ready();
        const edit = screen.getByRole('button', { name: 'Edit Example' });
        await userEvent.click(edit);
        const modal = screen.getByRole('dialog', { name: 'Edit favorite' });
        expect(modal.parentElement).toBe(document.body);
        await userEvent.type(within(modal).getByLabelText('Name', { exact: true }), ' changed');
        await userEvent.click(within(modal).getByRole('combobox', { name: 'Open preference' }));
        expect(within(modal).getByRole('listbox', { name: 'Open preference' })).toBeTruthy();
        await userEvent.click(within(modal).getByRole('option', { name: 'Separate tab' }));
        fireEvent(modal, new Event('cancel', { cancelable: true }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(edit);
        expect(data[0].name).toBe('Example');
        expect(requests.filter((request) => request.body && request.path === '/api/favorites')).toHaveLength(0);
    });

    it('saves group order for both pickers without changing favorites or the active group', async () => {
        groupNames = ['Personal', 'Sports', 'News'];
        const original = structuredClone(data);
        await ready();
        await userEvent.click(screen.getByRole('combobox', { name: 'Group' }));
        await userEvent.click(screen.getByRole('option', { name: 'Sports' }));
        await userEvent.click(screen.getByRole('combobox', { name: 'Group' }));
        await userEvent.click(screen.getByRole('option', { name: 'Reorder groups...' }));
        const modal = screen.getByRole('dialog', { name: 'Reorder groups' });
        expect((within(modal).getByRole('button', { name: 'Move Personal up' }) as HTMLButtonElement).disabled).toBe(
            true
        );
        expect((within(modal).getByRole('button', { name: 'Move News down' }) as HTMLButtonElement).disabled).toBe(
            true
        );
        await userEvent.click(within(modal).getByRole('button', { name: 'Move Sports up' }));
        await userEvent.click(within(modal).getByRole('button', { name: 'Save order' }));
        await waitFor(() => expect(groupNames).toEqual(['Sports', 'Personal', 'News']));
        expect(data).toEqual(original);
        expect(screen.getByRole('combobox', { name: 'Group' }).textContent).toBe('Sports');
        expect(
            requests.find((request) => request.path === '/api/favorites' && request.body)?.body?.operation
        ).toBeUndefined();
        await userEvent.click(screen.getByRole('combobox', { name: 'Group' }));
        expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
            'All sites',
            'Sports',
            'Personal',
            'News',
            'Create group...',
            'Reorder groups...',
        ]);
        await userEvent.keyboard('{Escape}');
        await userEvent.keyboard('{Alt>}g{/Alt}');
        expect(
            within(screen.getByRole('dialog', { name: 'Switch group' }))
                .getAllByRole('option')
                .map((option) => option.textContent)
        ).toEqual(['All sites3', 'Sports0', 'Personal0', 'News0']);
    });

    it('discards canceled group ordering and allows retry after a save failure', async () => {
        groupNames = ['Personal', 'Sports'];
        await ready();
        async function open() {
            await userEvent.click(screen.getByRole('combobox', { name: 'Group' }));
            await userEvent.click(screen.getByRole('option', { name: 'Reorder groups...' }));
            await userEvent.click(screen.getByRole('button', { name: 'Move Sports up' }));
        }
        await open();
        fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
        expect(groupNames).toEqual(['Personal', 'Sports']);
        await open();
        failSave = true;
        await userEvent.click(screen.getByRole('button', { name: 'Save order' }));
        await screen.findByText(/Group order could not be saved/);
        failSave = false;
        await userEvent.click(screen.getByRole('button', { name: 'Save order' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(groupNames).toEqual(['Sports', 'Personal']);
    });

    it('shows gateway-protected status without a duplicate SiteDock sign-out control', async () => {
        gatewayAuthenticated = true;
        await ready();
        expect(screen.getByText('Access protected')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    });

    it('restores the removed ungrouped preference to All sites', async () => {
        localStorage.setItem('sitedock.group', 'ungrouped');
        await ready();
        expect(screen.getByRole('combobox', { name: 'Group' }).textContent).toBe('All sites');
        await userEvent.click(screen.getByRole('combobox', { name: 'Group' }));
        expect(screen.queryByRole('option', { name: 'Ungrouped' })).toBeNull();
    });

    it('adds an existing site to multiple groups, preserves membership on failure, and clears assignments', async () => {
        groupNames = ['Personal', 'Sports'];
        data[0] = { ...data[0], groups: ['Personal'] };
        await ready();
        const frame = screen.getByTitle('Example');
        await userEvent.click(screen.getByRole('button', { name: 'Edit Example' }));
        expect((screen.getByRole('checkbox', { name: 'Personal' }) as HTMLInputElement).checked).toBe(true);
        await userEvent.click(screen.getByRole('checkbox', { name: 'Sports' }));
        failSave = true;
        await userEvent.click(screen.getByRole('button', { name: 'Save favorite' }));
        await screen.findByText('Changes are still pending. Disk unavailable');
        expect((screen.getByRole('checkbox', { name: 'Personal' }) as HTMLInputElement).checked).toBe(true);
        expect((screen.getByRole('checkbox', { name: 'Sports' }) as HTMLInputElement).checked).toBe(true);
        failSave = false;
        await userEvent.click(screen.getByRole('button', { name: 'Save favorite' }));
        await waitFor(() => expect(data[0].groups).toEqual(['Personal', 'Sports']));
        for (const group of ['Personal', 'Sports', 'All sites']) {
            await userEvent.click(screen.getByRole('combobox', { name: 'Group' }));
            await userEvent.click(screen.getByRole('option', { name: group }));
            expect(screen.getAllByRole('button', { name: 'Example' })).toHaveLength(1);
            expect(screen.getByTitle('Example')).toBe(frame);
        }
        await userEvent.click(screen.getByRole('combobox', { name: 'Group' }));
        await userEvent.click(screen.getByRole('option', { name: 'Sports' }));
        await userEvent.click(screen.getByRole('button', { name: 'Edit Example' }));
        await userEvent.click(screen.getByRole('checkbox', { name: 'Personal' }));
        await userEvent.click(screen.getByRole('checkbox', { name: 'Sports' }));
        await userEvent.click(screen.getByRole('button', { name: 'Save favorite' }));
        await waitFor(() => expect(data[0].groups).toBeUndefined());
        expect(screen.getByRole('combobox', { name: 'Group' }).textContent).toBe('All sites');
        expect(screen.getByTitle('Example')).toBe(frame);
    });

    it('creates groups, assigns sites, filters and preserves mounted pages', async () => {
        await ready();
        const frame = screen.getByTitle('Example');
        await userEvent.click(screen.getByRole('combobox', { name: 'Group' }));
        await userEvent.click(screen.getByRole('option', { name: 'Create group...' }));
        await userEvent.type(screen.getByLabelText('Group name'), 'Personal');
        await userEvent.click(screen.getByRole('button', { name: 'Create group' }));
        await waitFor(() => expect(groupNames).toEqual(['Personal']));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(localStorage.getItem('sitedock.group')).toBe('group:Personal');
        expect(screen.queryByRole('button', { name: 'Example' })).toBeNull();
        expect(screen.getByTitle('Example')).toBe(frame);
        await userEvent.click(screen.getByRole('combobox', { name: 'Group' }));
        await userEvent.click(screen.getByRole('option', { name: 'All sites' }));
        await userEvent.click(screen.getByRole('button', { name: 'Edit Example' }));
        await userEvent.click(screen.getByRole('checkbox', { name: 'Personal' }));
        await userEvent.click(screen.getByRole('button', { name: 'Save favorite' }));
        await waitFor(() => expect(data[0].groups).toEqual(['Personal']));
        await userEvent.click(screen.getByRole('combobox', { name: 'Group' }));
        await userEvent.click(screen.getByRole('option', { name: 'Personal' }));
        expect(screen.getByRole('button', { name: 'Example' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Other' })).toBeNull();
        expect(screen.getByTitle('Example')).toBe(frame);
        await userEvent.click(screen.getByRole('button', { name: 'Add favorite' }));
        expect((screen.getByRole('checkbox', { name: 'Personal' }) as HTMLInputElement).checked).toBe(true);
    });

    it('orders and numbers only the selected group while preserving other groups', async () => {
        groupNames = ['Personal', 'Sports'];
        data = data.map((favorite, index) => ({ ...favorite, groups: [index === 1 ? 'Sports' : 'Personal'] }));
        await ready();
        await userEvent.click(screen.getByRole('combobox', { name: 'Group' }));
        await userEvent.click(screen.getByRole('option', { name: 'Personal' }));
        const external = screen.getByRole('link', { name: 'Open News in a separate tab' });
        const activate = vi.spyOn(external, 'click').mockImplementation(() => {});
        fireEvent.keyDown(window, { code: 'Digit2', altKey: true });
        expect(activate).toHaveBeenCalledOnce();
        await userEvent.click(screen.getByRole('button', { name: 'Move Example down' }));
        await waitFor(() => expect(data.map((favorite) => favorite.id)).toEqual(['three', 'two', 'one']));
        expect(groupNames).toEqual(['Personal', 'Sports']);
        expect(screen.getByRole('button', { name: 'Example' }).getAttribute('aria-keyshortcuts')).toBe('Alt+2');
        expect(screen.getByRole('button', { name: 'Move Example down' }).hasAttribute('disabled')).toBe(true);
    });

    it('rejects duplicate group names and preserves failed creates for retry', async () => {
        groupNames = ['Personal'];
        await ready();
        await userEvent.click(screen.getByRole('combobox', { name: 'Group' }));
        await userEvent.click(screen.getByRole('option', { name: 'Create group...' }));
        await userEvent.type(screen.getByLabelText('Group name'), ' personal ');
        await userEvent.click(screen.getByRole('button', { name: 'Create group' }));
        expect(screen.getByRole('alert').textContent).toContain('already exists');
        await userEvent.clear(screen.getByLabelText('Group name'));
        await userEvent.type(screen.getByLabelText('Group name'), 'News');
        failSave = true;
        await userEvent.click(screen.getByRole('button', { name: 'Create group' }));
        await screen.findByText(
            'The group could not be saved. Retry, or cancel to review the pending changes on the dashboard.'
        );
        expect((screen.getByLabelText('Group name') as HTMLInputElement).value).toBe('News');
        failSave = false;
        await userEvent.click(screen.getByRole('button', { name: 'Create group' }));
        await waitFor(() => expect(groupNames).toEqual(['Personal', 'News']));
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('shows concurrent groups and discards pending groups when accepting the latest list', async () => {
        await ready();
        await userEvent.click(screen.getByRole('combobox', { name: 'Group' }));
        await userEvent.click(screen.getByRole('option', { name: 'Create group...' }));
        await userEvent.type(screen.getByLabelText('Group name'), 'Personal');
        conflict = true;
        await userEvent.click(screen.getByRole('button', { name: 'Create group' }));
        await screen.findByText(
            'The group could not be saved. Retry, or cancel to review the pending changes on the dashboard.'
        );
        await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.getByText('Groups: News')).toBeTruthy();
        await userEvent.click(screen.getByRole('button', { name: 'Use latest list' }));
        await userEvent.click(screen.getByRole('combobox', { name: 'Group' }));
        expect(screen.getByRole('option', { name: 'News' })).toBeTruthy();
        expect(screen.queryByRole('option', { name: 'Personal' })).toBeNull();
    });

    it('minimizes and restores the sidebar without reloading embedded pages', async () => {
        await ready();
        const frame = screen.getByTitle('Example');
        const logo = screen.getByRole('button', { name: 'Minimize favorites' });
        expect(logo.querySelector('img')?.getAttribute('src')).toBe('/favicon.svg?v=2');
        expect(logo.querySelector('img.brand-icon-light')?.getAttribute('src')).toBe('/brand-light.svg?v=2');
        await userEvent.click(logo);
        expect(document.querySelector('.app')?.classList.contains('sidebar-minimized')).toBe(true);
        expect(localStorage.getItem('sitedock.sidebar-minimized')).toBe('true');
        expect(screen.getByTitle('Example')).toBe(frame);
        const toggle = document.querySelector<HTMLButtonElement>('.brand-toggle')!;
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        await userEvent.click(toggle);
        expect(document.querySelector('.app')?.classList.contains('sidebar-minimized')).toBe(false);
        expect(screen.getByTitle('Example')).toBe(frame);
    });
    it('activates favorites by Alt+number and follows reordered positions', async () => {
        await ready();
        expect(fireEvent.keyDown(window, { code: 'Digit2', altKey: true })).toBe(false);
        await screen.findByTitle('Other');
        expect(screen.getByRole('button', { name: 'Other' }).getAttribute('aria-current')).toBe('page');
        const external = screen.getByRole('link', { name: 'Open News in a separate tab' });
        const activate = vi.spyOn(external, 'click').mockImplementation(() => {});
        fireEvent.keyDown(window, { code: 'Digit3', altKey: true });
        expect(activate).toHaveBeenCalledOnce();
        await userEvent.click(screen.getByRole('button', { name: 'Move Example down' }));
        await waitFor(() => expect(data[0].id).toBe('two'));
        fireEvent.keyDown(window, { code: 'Digit1', altKey: true });
        expect(screen.getByRole('button', { name: 'Other' }).getAttribute('aria-current')).toBe('page');
        expect(screen.getByRole('button', { name: 'Other' }).getAttribute('aria-keyshortcuts')).toBe('Alt+1');
    });
    it('ignores unavailable numbers, other modifiers, repeats, forms, and modals', async () => {
        await ready();
        for (const properties of [
            { code: 'Digit2' },
            { code: 'Digit2', altKey: true, ctrlKey: true },
            { key: '2', ctrlKey: true },
            { code: 'Digit2', altKey: true, shiftKey: true },
            { code: 'Digit2', altKey: true, metaKey: true },
            { code: 'Digit2', altKey: true, repeat: true },
            { code: 'Digit0', altKey: true },
            { code: 'Digit9', altKey: true },
            { code: 'Numpad0', altKey: true },
            { code: 'Numpad9', altKey: true },
        ])
            expect(fireEvent.keyDown(window, properties)).toBe(true);
        expect(screen.queryByTitle('Other')).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: 'Edit Example' }));
        expect(fireEvent.keyDown(screen.getByLabelText('Name'), { code: 'Digit2', altKey: true })).toBe(true);
        expect(screen.queryByTitle('Other')).toBeNull();
        await userEvent.click(screen.getAllByRole('button', { name: 'Close editor' })[0]);
        await userEvent.click(screen.getByRole('button', { name: 'Delete Example' }));
        expect(fireEvent.keyDown(window, { code: 'Digit2', altKey: true })).toBe(true);
        expect(screen.queryByTitle('Other')).toBeNull();
    });
    it('matches the physical key so macOS Option characters still activate favorites', async () => {
        await ready();
        expect(fireEvent.keyDown(window, { key: '™', code: 'Digit2', altKey: true })).toBe(false);
        await screen.findByTitle('Other');
    });
    it('accepts numpad digits with or without Num Lock', async () => {
        await ready();
        expect(fireEvent.keyDown(window, { key: 'ArrowDown', code: 'Numpad2', altKey: true })).toBe(false);
        await screen.findByTitle('Other');
    });
    it('runs shortcuts from the closed group dropdown but not while its list is open', async () => {
        await ready();
        const groups = screen.getByRole('combobox', { name: 'Group' });
        await userEvent.click(groups);
        expect(fireEvent.keyDown(screen.getByRole('listbox'), { code: 'Digit2', altKey: true })).toBe(true);
        await userEvent.click(screen.getByRole('option', { name: 'All sites' }));
        expect(groups.getAttribute('aria-expanded')).toBe('false');
        expect(fireEvent.keyDown(groups, { code: 'Digit2', altKey: true })).toBe(false);
        await screen.findByTitle('Other');
    });
    it('switches groups from the Alt+G HUD with filtering, cycling, counts, and focus restore', async () => {
        groupNames = ['Personal', 'Sports'];
        data = data.map((favorite, index) => ({ ...favorite, groups: [index === 1 ? 'Sports' : 'Personal'] }));
        await ready();
        const reload = screen.getByRole('button', { name: 'Reload selected site' });
        reload.focus();
        expect(fireEvent.keyDown(window, { key: '©', code: 'KeyG', altKey: true })).toBe(false);
        const hud = await screen.findByRole('dialog', { name: 'Switch group' });
        const filter = screen.getByRole('combobox', { name: 'Filter groups' });
        expect(document.activeElement).toBe(filter);
        const options = () => screen.getAllByRole('option').filter((option) => hud.contains(option));
        expect(options().map((option) => option.textContent)).toEqual(['All sites3', 'Personal2', 'Sports1']);
        expect(options()[0].getAttribute('aria-selected')).toBe('true');
        expect(fireEvent.keyDown(filter, { code: 'KeyG', altKey: true })).toBe(false);
        expect(options()[1].getAttribute('aria-selected')).toBe('true');
        expect(filter.getAttribute('aria-activedescendant')).toBe(options()[1].id);
        fireEvent.keyDown(filter, { code: 'KeyG', altKey: true });
        fireEvent.keyDown(filter, { code: 'KeyG', altKey: true });
        expect(options()[0].getAttribute('aria-selected')).toBe('true');
        expect(fireEvent.keyDown(filter, { code: 'Digit2', altKey: true })).toBe(true);
        expect(screen.queryByTitle('Other')).toBeNull();
        await userEvent.type(filter, 'zzz');
        expect(screen.getByText('No matching groups')).toBeTruthy();
        fireEvent.keyDown(filter, { key: 'Enter' });
        fireEvent.keyDown(filter, { code: 'KeyG', altKey: true });
        expect(screen.getByRole('dialog', { name: 'Switch group' })).toBeTruthy();
        await userEvent.clear(filter);
        await userEvent.type(filter, 'sp');
        expect(options().map((option) => option.textContent)).toEqual(['Sports1']);
        await userEvent.keyboard('{Enter}');
        expect(screen.queryByRole('dialog', { name: 'Switch group' })).toBeNull();
        expect(screen.getByRole('combobox', { name: 'Group' }).textContent).toBe('Sports');
        expect(localStorage.getItem('sitedock.group')).toBe('group:Sports');
        expect(document.activeElement).toBe(reload);
        fireEvent.keyDown(window, { code: 'KeyG', altKey: true });
        await screen.findByRole('dialog', { name: 'Switch group' });
        fireEvent.keyDown(screen.getByRole('combobox', { name: 'Filter groups' }), { key: 'ArrowUp' });
        fireEvent(screen.getByRole('dialog', { name: 'Switch group' }), new Event('cancel', { cancelable: true }));
        expect(screen.queryByRole('dialog', { name: 'Switch group' })).toBeNull();
        expect(screen.getByRole('combobox', { name: 'Group' }).textContent).toBe('Sports');
    });
    it('does not open the HUD from form fields or while another modal is open', async () => {
        await ready();
        await userEvent.click(screen.getByRole('button', { name: 'Edit Example' }));
        expect(fireEvent.keyDown(screen.getByLabelText('Name'), { code: 'KeyG', altKey: true })).toBe(true);
        expect(fireEvent.keyDown(window, { code: 'KeyG', altKey: true })).toBe(true);
        expect(screen.queryByRole('dialog', { name: 'Switch group' })).toBeNull();
    });
    it('accepts forwarded keys only from the active frame and its exact origin', async () => {
        await ready();
        const frame = screen.getByTitle('Example') as HTMLIFrameElement;
        const post = (
            data: unknown,
            origin = 'https://example.com',
            source: MessageEventSource | null = frame.contentWindow
        ) => fireEvent(window, new MessageEvent('message', { data, origin, source }));
        post({ type: 'sitedock:key', code: 'Digit2' }, 'https://evil.example');
        post({ type: 'sitedock:key', code: 'Digit2' }, 'https://example.com', window);
        post({ type: 'sitedock:key', code: 'Digit2' }, 'https://example.com', null);
        for (const data of [
            null,
            'Digit2',
            { type: 'other', code: 'Digit2' },
            { type: 'sitedock:key', code: 'Digit0' },
            { type: 'sitedock:key', code: 'Digit22' },
            { type: 'sitedock:key', code: 2 },
            { type: 'sitedock:key', code: 'KeyH' },
        ])
            post(data);
        expect(screen.queryByTitle('Other')).toBeNull();
        post({ type: 'sitedock:key', code: 'Digit2' });
        await screen.findByTitle('Other');
        expect(screen.getByRole('button', { name: 'Other' }).getAttribute('aria-current')).toBe('page');
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Other' }));
        post({ type: 'sitedock:key', code: 'Digit1' });
        expect(screen.getByRole('button', { name: 'Other' }).getAttribute('aria-current')).toBe('page');
        const other = screen.getByTitle('Other') as HTMLIFrameElement;
        post({ type: 'sitedock:key', code: 'KeyG' }, 'https://example.org', other.contentWindow);
        expect(await screen.findByRole('dialog', { name: 'Switch group' })).toBeTruthy();
        fireEvent(screen.getByRole('dialog', { name: 'Switch group' }), new Event('cancel', { cancelable: true }));
        await userEvent.click(screen.getByRole('button', { name: 'Edit Other' }));
        post({ type: 'sitedock:key', code: 'KeyG' }, 'https://example.org', other.contentWindow);
        expect(screen.queryByRole('dialog', { name: 'Switch group' })).toBeNull();
    });
    it('focuses the open link when a forwarded key selects a separate-tab favorite', async () => {
        await ready();
        const frame = screen.getByTitle('Example') as HTMLIFrameElement;
        const external = screen.getByRole('link', { name: 'Open News in a separate tab' });
        const activate = vi.spyOn(external, 'click').mockImplementation(() => {
            external.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        fireEvent(
            window,
            new MessageEvent('message', {
                data: { type: 'sitedock:key', code: 'Digit3' },
                origin: 'https://example.com',
                source: frame.contentWindow,
            })
        );
        expect(activate).toHaveBeenCalledOnce();
        await waitFor(() => expect(document.activeElement?.textContent).toBe('Open News'));
    });
    it('reloads an embedded frame when the user returns from Open tab', async () => {
        await ready();
        const before = screen.getByTitle('Example');
        const link = screen.getByRole('link', { name: 'Open Example in a new tab' });
        link.addEventListener('click', (event) => event.preventDefault());
        fireEvent.click(link);
        expect(screen.getByTitle('Example')).toBe(before);
        fireEvent(window, new Event('focus'));
        await waitFor(() => expect(screen.getByTitle('Example')).not.toBe(before));
        const reloaded = screen.getByTitle('Example');
        fireEvent(window, new Event('focus'));
        expect(screen.getByTitle('Example')).toBe(reloaded);
    });
    it('retains visited frames and reloads only the selected frame from its configured URL', async () => {
        await ready();
        const first = screen.getByTitle('Example');
        expect(first.getAttribute('sandbox')).toBe(
            'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox'
        );
        expect(first.getAttribute('referrerpolicy')).toBe('no-referrer');
        await userEvent.click(screen.getByRole('button', { name: 'Other' }));
        expect(first.classList.contains('active')).toBe(false);
        expect(first.getAttribute('aria-hidden')).toBe('true');
        expect(first.hasAttribute('inert')).toBe(true);
        const other = screen.getByTitle('Other');
        expect(other.classList.contains('active')).toBe(true);
        fireEvent.load(other);
        expect(other.classList.contains('loaded')).toBe(true);
        await userEvent.click(screen.getByRole('button', { name: 'Example' }));
        expect(screen.getByTitle('Example')).toBe(first);
        await userEvent.click(screen.getByRole('button', { name: 'Reload selected site' }));
        expect(screen.getByTitle('Example')).not.toBe(first);
        expect(screen.getByTitle('Example').getAttribute('src')).toBe('https://example.com/');
        expect(screen.getByTitle('Other')).toBe(other);
    });
    it('clears frames, shared data, and editor input on session loss detected on focus', async () => {
        await ready();
        await userEvent.click(screen.getByRole('button', { name: 'Edit Example' }));
        await userEvent.type(screen.getByLabelText('Name'), ' pending');
        authenticated = false;
        fireEvent.focus(window);
        await screen.findByRole('button', { name: 'Sign in' });
        expect(document.querySelectorAll('iframe')).toHaveLength(0);
        expect(screen.queryByText('Example pending')).toBeNull();
        expect(screen.queryByLabelText('Name')).toBeNull();
    });
    it('clears all frames on explicit logout', async () => {
        await ready();
        await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
        await screen.findByRole('button', { name: 'Sign in' });
        expect(document.querySelectorAll('iframe')).toHaveLength(0);
        expect(requests.some((request) => request.path === '/api/logout')).toBe(true);
    });
    it('provides direct safe external links without mounting a frame', async () => {
        await ready();
        const link = screen.getByRole('link', { name: 'Open News in a separate tab' });
        expect(link.getAttribute('href')).toBe('https://news.example.com/');
        expect(link.getAttribute('target')).toBe('_blank');
        expect(link.getAttribute('rel')).toContain('noopener');
        fireEvent.click(link);
        await screen.findByRole('heading', { name: 'News', level: 2 });
        expect(screen.queryByTitle('News')).toBeNull();
    });
    it('logs in through the owner form', async () => {
        authenticated = false;
        render(<App />);
        await screen.findByRole('button', { name: 'Sign in' });
        await userEvent.type(screen.getByLabelText('Username'), 'owner');
        await userEvent.type(screen.getByLabelText('Password'), 'a long password');
        await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
        await screen.findByRole('button', { name: 'Example' });
        expect(requests.find((request) => request.path === '/api/login')?.body).toEqual({
            username: 'owner',
            password: 'a long password',
        });
    });
    it('forces HTTP into external mode under HTTPS and explains the reason', async () => {
        vi.stubGlobal('location', { protocol: 'https:', origin: 'https://dock.example.com' });
        data = [{ ...favorites[0], url: 'http://example.com/' }];
        render(<App />);
        await screen.findByRole('link', { name: 'Open Example in a separate tab' });
        await screen.findByText(/Your HTTPS connection prevents it from being embedded here/);
        expect(document.querySelectorAll('iframe')).toHaveLength(0);
        expect(data[0].mode).toBe('embed');
    });
});

describe('favorite edits and reconciliation', () => {
    it('cancels modal deletion without changing the list', async () => {
        await ready();
        await userEvent.click(screen.getByRole('button', { name: 'Delete Example' }));
        await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getByTitle('Example')).toBeTruthy();
        expect(requests.some((request) => request.body?.favorites)).toBe(false);
    });
    it('adds, edits, and deletes favorites and removes obsolete frames', async () => {
        await ready();
        await userEvent.click(screen.getByRole('button', { name: 'Add favorite' }));
        await userEvent.type(screen.getByLabelText('Name'), 'New site');
        await userEvent.type(screen.getByLabelText('Website address'), 'https://new.example.com');
        await userEvent.click(screen.getByRole('button', { name: 'Save favorite' }));
        await screen.findByRole('button', { name: 'Edit New site' });
        await userEvent.click(screen.getByRole('button', { name: 'Edit New site' }));
        await userEvent.clear(screen.getByLabelText('Website address'));
        await userEvent.type(screen.getByLabelText('Website address'), 'https://updated.example.com/');
        await userEvent.click(screen.getByRole('button', { name: 'Save favorite' }));
        await waitFor(() =>
            expect(screen.getByTitle('New site').getAttribute('src')).toBe('https://updated.example.com/')
        );
        await userEvent.click(screen.getByRole('button', { name: 'Delete New site' }));
        const modal = screen.getByRole('dialog', { name: 'Delete favorite?' });
        expect(modal.textContent).toContain('New site');
        expect(screen.getByTitle('New site')).toBeTruthy();
        await userEvent.click(screen.getByRole('button', { name: 'Delete favorite' }));
        await waitFor(() => expect(screen.queryByTitle('New site')).toBeNull());
    });
    it('preserves failed form input and concurrent pending changes until explicit reconciliation', async () => {
        await ready();
        conflict = true;
        await userEvent.click(screen.getByRole('button', { name: 'Edit Example' }));
        await userEvent.clear(screen.getByLabelText('Name'));
        await userEvent.type(screen.getByLabelText('Name'), 'My pending name');
        await userEvent.click(screen.getByRole('button', { name: 'Save favorite' }));
        await screen.findByText('Another browser changed your favorites.');
        expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('My pending name');
        expect(screen.getByText('Changed elsewhere')).toBeTruthy();
        expect((screen.getByRole('button', { name: 'Save favorite' }) as HTMLButtonElement).disabled).toBe(true);
        const writesBefore = requests.filter((request) => request.body?.favorites).length;
        await userEvent.click(screen.getByRole('button', { name: 'Keep pending list for review' }));
        expect(requests.filter((request) => request.body?.favorites)).toHaveLength(writesBefore);
        conflict = false;
        await userEvent.click(screen.getByRole('button', { name: 'Save favorite' }));
        await screen.findByRole('button', { name: 'Edit My pending name' });
        expect(requests.filter((request) => request.body?.favorites).at(-1)?.body?.baseRevision).toBe(7);
    });
    it('keeps form fields when storage fails and retries the pending edit', async () => {
        await ready();
        failSave = true;
        await userEvent.click(screen.getByRole('button', { name: 'Edit Example' }));
        await userEvent.type(screen.getByLabelText('Name'), ' edited');
        await userEvent.click(screen.getByRole('button', { name: 'Save favorite' }));
        await screen.findByText(/Disk unavailable/);
        expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Example edited');
        failSave = false;
        await userEvent.click(screen.getByRole('button', { name: 'Save favorite' }));
        await screen.findByRole('button', { name: 'Edit Example edited' });
    });
    it('rejects every configured SiteDock origin in the editor', async () => {
        await ready();
        await userEvent.click(screen.getByRole('button', { name: 'Edit Example' }));
        await userEvent.clear(screen.getByLabelText('Website address'));
        await userEvent.type(screen.getByLabelText('Website address'), 'https://dock.example.com/path');
        await userEvent.click(screen.getByRole('button', { name: 'Save favorite' }));
        await screen.findByText('Site Dock cannot be added to its own favorites.');
        expect(requests.some((request) => request.body?.favorites)).toBe(false);
    });
    it('saves keyboard reorder intent with the full list', async () => {
        await ready();
        const button = screen.getByRole('button', { name: 'Move Example down' });
        button.focus();
        await userEvent.keyboard('{Enter}');
        await waitFor(() => expect(requests.some((request) => request.body?.operation === 'reorder')).toBe(true));
        expect(data.map((item) => item.id)).toEqual(['two', 'one', 'three']);
    });
    it('uses arrow controls without drag handles or draggable rows', async () => {
        await ready();
        expect(document.querySelector('.drag-grip')).toBeNull();
        expect(document.querySelector('[draggable="true"]')).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: 'Move Example down' }));
        await waitFor(() => expect(data.map((item) => item.id)).toEqual(['two', 'one', 'three']));
    });
    it('resizes with a captured pointer without sending events to embedded sites', async () => {
        await ready();
        vi.stubGlobal('PointerEvent', MouseEvent);
        const separator = screen.getByRole('separator', { name: 'Sidebar width' });
        Object.defineProperty(separator, 'setPointerCapture', { value: vi.fn() });
        fireEvent.pointerDown(separator, { button: 0, clientX: 280, pointerId: 1 });
        expect(document.querySelector('.app')?.classList.contains('interacting')).toBe(true);
        fireEvent.pointerMove(separator, { clientX: 330, pointerId: 1 });
        expect(separator.getAttribute('aria-valuenow')).toBe('330');
        fireEvent.pointerUp(separator, { pointerId: 1 });
        expect(document.querySelector('.app')?.classList.contains('interacting')).toBe(false);
    });
    it('resizes with arrow keys and stores theme preference', async () => {
        await ready();
        const separator = screen.getByRole('separator', { name: 'Sidebar width' });
        fireEvent.keyDown(separator, { key: 'ArrowRight' });
        expect(separator.getAttribute('aria-valuenow')).toBe('290');
        fireEvent.keyDown(separator, { key: 'Home' });
        expect(separator.getAttribute('aria-valuenow')).toBe('220');
        await userEvent.click(screen.getByRole('button', { name: 'Theme: Midnight' }));
        await userEvent.click(screen.getByRole('button', { name: 'Light' }));
        expect(document.documentElement.dataset.theme).toBe('light');
        expect(localStorage.getItem('sitedock.theme')).toBe('light');
    });
});

describe('ten-site shortcuts and group limit', () => {
    const pills = () => [...document.querySelectorAll('.shortcut-pill')].map((pill) => pill.textContent);
    async function readyWith(title: string) {
        render(<App />);
        await screen.findByTitle(title);
    }
    const current = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-current');

    it('numbers the first 10 sites 1-9 then 0 and opens the 10th with Alt+0 in All sites', async () => {
        data = sites(12);
        await readyWith('Site 1');
        expect(pills()).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']);
        expect(screen.getByRole('button', { name: 'Site 10' }).getAttribute('aria-keyshortcuts')).toBe('Alt+0');
        expect(screen.getByRole('button', { name: 'Site 10' }).getAttribute('aria-describedby')).toBeNull();
        expect(screen.getByRole('button', { name: 'Site 10' }).getAttribute('title')).toBeNull();
        expect(screen.getByRole('button', { name: 'Site 11' }).getAttribute('aria-keyshortcuts')).toBeNull();
        expect(fireEvent.keyDown(window, { code: 'Digit0', altKey: true })).toBe(false);
        await screen.findByTitle('Site 10');
        expect(current('Site 10')).toBe('page');
        fireEvent.keyDown(window, { code: 'Digit1', altKey: true });
        expect(current('Site 1')).toBe('page');
        expect(fireEvent.keyDown(window, { key: 'Insert', code: 'Numpad0', altKey: true })).toBe(false);
        expect(current('Site 10')).toBe('page');
    });

    it('opens an external 10th site in a group with Alt+0 and follows reordering', async () => {
        groupNames = ['G'];
        data = [
            ...sites(9, ['G']),
            { id: 's10', name: 'Site 10', url: 'https://s10.example.com/', mode: 'external', groups: ['G'] },
        ];
        localStorage.setItem('sitedock.group', 'group:G');
        await readyWith('Site 1');
        const external = screen.getByRole('link', { name: 'Open Site 10 in a separate tab' });
        expect(external.getAttribute('aria-keyshortcuts')).toBe('Alt+0');
        const activate = vi.spyOn(external, 'click').mockImplementation(() => {});
        fireEvent.keyDown(window, { code: 'Digit0', altKey: true });
        expect(activate).toHaveBeenCalledOnce();
        await userEvent.click(screen.getByRole('button', { name: 'Move Site 10 up' }));
        await waitFor(() => expect(data[8].id).toBe('s10'));
        fireEvent.keyDown(window, { code: 'Digit0', altKey: true });
        await screen.findByTitle('Site 9');
        expect(current('Site 9')).toBe('page');
    });

    it('leaves Alt+0 unconsumed when fewer than 10 sites are visible', async () => {
        await ready();
        expect(fireEvent.keyDown(window, { code: 'Digit0', altKey: true })).toBe(true);
        expect(pills()).toEqual(['1', '2', '3']);
    });

    it('hides a group and its members from All sites, selectors, and the group switcher, then restores it', async () => {
        groupNames = ['Hidden', 'Visible'];
        data = [
            { ...favorites[0], groups: ['Hidden', 'Visible'] },
            { ...favorites[1], groups: ['Hidden'] },
            { ...favorites[2], groups: ['Visible'] },
        ];
        await readyWith('Example');
        await userEvent.click(screen.getByRole('combobox', { name: 'Group' }));
        await userEvent.click(screen.getByRole('option', { name: 'Hidden' }));
        await userEvent.click(screen.getByRole('button', { name: 'Visibility' }));
        const visibility = screen.getByRole('dialog', { name: 'Visibility' });
        await userEvent.click(within(visibility).getByRole('button', { name: 'Hidden' }));
        await userEvent.click(within(visibility).getByRole('button', { name: 'Visible' }));
        expect(within(visibility).getAllByRole('listitem')).toHaveLength(4);
        await userEvent.click(within(visibility).getByRole('button', { name: 'Hide group Hidden' }));
        await waitFor(() => expect(hiddenGroupNames).toEqual(['Hidden']));
        expect(within(visibility).getAllByRole('listitem')).toHaveLength(4);
        expect(within(visibility).getAllByText('Hidden by group: Hidden')).toHaveLength(3);
        await userEvent.click(screen.getByRole('button', { name: 'Close visibility' }));
        expect(screen.queryByRole('button', { name: 'Example' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Other' })).toBeNull();
        expect(screen.getByRole('link', { name: 'Open News in a separate tab' })).toBeTruthy();
        expect(screen.getByRole('combobox', { name: 'Group' }).textContent).toContain('All sites');
        await userEvent.click(screen.getByRole('button', { name: 'Edit News' }));
        expect(screen.queryByRole('checkbox', { name: 'Hidden' })).toBeNull();
        await userEvent.click(screen.getAllByRole('button', { name: 'Close editor' })[0]);
        fireEvent.keyDown(window, { code: 'Digit1', altKey: true });
        expect(screen.getByRole('link', { name: 'Open News in a separate tab' }).getAttribute('aria-current')).toBe(
            'page'
        );

        fireEvent.keyDown(window, { key: 'g', code: 'KeyG', altKey: true });
        expect(screen.queryByRole('option', { name: /Hidden/ })).toBeNull();
        expect(screen.getByRole('option', { name: /Visible/ })).toBeTruthy();
        await userEvent.keyboard('{Escape}');

        await userEvent.click(screen.getByRole('button', { name: 'Visibility' }));
        await userEvent.click(screen.getByRole('button', { name: 'Show group Hidden' }));
        await waitFor(() => expect(hiddenGroupNames).toEqual([]));
        expect(screen.getByRole('button', { name: 'Hide group Hidden' })).toBeTruthy();
        await userEvent.click(screen.getByRole('button', { name: 'Close visibility' }));
        expect(screen.getByRole('button', { name: 'Example' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Other' })).toBeTruthy();
    });

    it('hides a favorite explicitly and restores it without changing group visibility', async () => {
        groupNames = ['G'];
        data = [{ ...favorites[0], groups: ['G'] }, favorites[1], favorites[2]];
        await readyWith('Example');
        expect(screen.queryByRole('button', { name: 'Hide Example' })).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: 'Visibility' }));
        await userEvent.click(screen.getByRole('button', { name: 'G' }));
        await userEvent.click(screen.getByRole('button', { name: 'Ungrouped' }));
        await userEvent.click(screen.getByRole('button', { name: 'Hide favorite Example' }));
        await waitFor(() => expect(data[0].hidden).toBe(true));
        expect(screen.queryByRole('button', { name: 'Example' })).toBeNull();
        expect(screen.getByText('Example')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Hide favorite Other' })).toBeTruthy();
        await userEvent.click(screen.getByRole('button', { name: 'Show favorite Example' }));
        await waitFor(() => expect(data[0].hidden).toBe(false));
        expect(screen.getByRole('button', { name: 'Hide favorite Example' })).toBeTruthy();
        await userEvent.click(screen.getByRole('button', { name: 'Close visibility' }));
        expect(screen.getByRole('button', { name: 'Example' })).toBeTruthy();
        expect(hiddenGroupNames).toEqual([]);
    });

    it('explains how to create groups when the visibility dialog has none', async () => {
        groupNames = [];
        await readyWith('Example');
        await userEvent.click(screen.getByRole('button', { name: 'Visibility' }));
        const visibility = screen.getByRole('dialog', { name: 'Visibility' });
        expect(within(visibility).getByRole('heading', { name: 'Groups' })).toBeTruthy();
        expect(within(visibility).getByText('No groups yet. Create one from the Group menu.')).toBeTruthy();
        await userEvent.click(within(visibility).getByRole('button', { name: 'Ungrouped' }));
        expect(within(visibility).getByRole('button', { name: 'Hide favorite Example' })).toBeTruthy();
    });

    it('keeps individual visibility separate from overlapping hidden groups in the visibility dialog', async () => {
        groupNames = ['A', 'B'];
        hiddenGroupNames = ['A', 'B'];
        data = [{ ...favorites[0], groups: ['A', 'B'], hidden: true }, favorites[1]];
        await readyWith('Other');
        await userEvent.click(screen.getByRole('button', { name: 'Visibility' }));
        const visibility = screen.getByRole('dialog', { name: 'Visibility' });
        for (const name of ['A', 'B', 'Ungrouped']) {
            await userEvent.click(within(visibility).getByRole('button', { name }));
        }
        expect(within(visibility).getAllByText('Hidden by group: A, B')).toHaveLength(2);
        const groupA = within(visibility).getByRole('region', { name: 'A' });
        const groupB = within(visibility).getByRole('region', { name: 'B' });
        expect(within(groupA).getByText('Example')).toBeTruthy();
        expect(within(groupB).getByText('Example')).toBeTruthy();
        expect(within(within(visibility).getByRole('region', { name: 'Ungrouped' })).getByText('Other')).toBeTruthy();
        await userEvent.click(within(visibility).getByRole('button', { name: 'Show group A' }));
        await waitFor(() => expect(hiddenGroupNames).toEqual(['B']));
        expect(data[0].hidden).toBe(true);
        await userEvent.click(within(groupA).getByRole('button', { name: 'Show favorite Example' }));
        await waitFor(() => expect(data[0].hidden).toBe(false));
        expect(within(visibility).getAllByText('Hidden by group: B')).toHaveLength(2);
        expect(within(groupB).getByRole('button', { name: 'Hide favorite Example' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Example' })).toBeNull();
        await userEvent.click(within(visibility).getByRole('button', { name: 'Show group B' }));
        await waitFor(() => expect(hiddenGroupNames).toEqual([]));
        expect(within(visibility).getAllByRole('listitem')).toHaveLength(3);
        await userEvent.click(screen.getByRole('button', { name: 'Close visibility' }));
        expect(screen.getByRole('button', { name: 'Example' })).toBeTruthy();
    });

    it('starts visibility groups collapsed on each open and expands independently of hiding', async () => {
        groupNames = ['A', 'Empty'];
        data = [{ ...favorites[0], groups: ['A'] }, favorites[1]];
        await readyWith('Example');
        await userEvent.click(screen.getByRole('button', { name: 'Visibility' }));
        let dialog = screen.getByRole('dialog', { name: 'Visibility' });
        for (const name of ['A', 'Empty', 'Ungrouped']) {
            expect(within(dialog).getByRole('button', { name }).getAttribute('aria-expanded')).toBe('false');
        }
        expect(within(dialog).queryByRole('button', { name: 'Hide favorite Example' })).toBeNull();
        await userEvent.click(within(dialog).getByRole('button', { name: 'Hide group A' }));
        await waitFor(() => expect(hiddenGroupNames).toEqual(['A']));
        expect(within(dialog).getByRole('button', { name: 'A' }).getAttribute('aria-expanded')).toBe('false');
        await userEvent.click(within(dialog).getByRole('button', { name: 'A' }));
        expect(within(dialog).getByRole('button', { name: 'Hide favorite Example' })).toBeTruthy();
        await userEvent.click(within(dialog).getByRole('button', { name: 'A' }));
        expect(within(dialog).queryByRole('button', { name: 'Hide favorite Example' })).toBeNull();
        await userEvent.click(within(dialog).getByRole('button', { name: 'Empty' }));
        expect(within(dialog).getByText('No favorites in this group.')).toBeTruthy();
        await userEvent.click(within(dialog).getByRole('button', { name: 'Close visibility' }));
        await userEvent.click(screen.getByRole('button', { name: 'Visibility' }));
        dialog = screen.getByRole('dialog', { name: 'Visibility' });
        expect(within(dialog).getByRole('button', { name: 'Empty' }).getAttribute('aria-expanded')).toBe('false');
    });

    it('accepts a forwarded zero from the active frame', async () => {
        data = sites(10);
        await readyWith('Site 1');
        const frame = screen.getByTitle('Site 1') as HTMLIFrameElement;
        fireEvent(
            window,
            new MessageEvent('message', {
                data: { type: 'sitedock:key', code: 'Digit0' },
                origin: 'https://s1.example.com',
                source: frame.contentWindow,
            })
        );
        await screen.findByTitle('Site 10');
        expect(current('Site 10')).toBe('page');
    });

    it('does not preselect or allow a full group when adding a favorite', async () => {
        groupNames = ['G', 'Other'];
        data = [...sites(10, ['G']), ...sites(1, undefined, 11)];
        localStorage.setItem('sitedock.group', 'group:G');
        await readyWith('Site 1');
        await userEvent.click(screen.getByRole('button', { name: 'Add favorite' }));
        const full = screen.getByRole('checkbox', { name: 'G (full)' }) as HTMLInputElement;
        expect(full.checked).toBe(false);
        expect(full.disabled).toBe(true);
        expect((screen.getByRole('checkbox', { name: 'Other' }) as HTMLInputElement).disabled).toBe(false);
    });

    it('lets existing members of a grandfathered group stay or leave', async () => {
        groupNames = ['G'];
        data = [...sites(12, ['G']), ...sites(1, undefined, 13)];
        await readyWith('Site 1');
        await userEvent.click(screen.getByRole('button', { name: 'Edit Site 2' }));
        const member = screen.getByRole('checkbox', { name: 'G' }) as HTMLInputElement;
        expect(member.checked).toBe(true);
        expect(member.disabled).toBe(false);
        await userEvent.clear(screen.getByLabelText('Name'));
        await userEvent.type(screen.getByLabelText('Name'), 'Renamed');
        await userEvent.click(screen.getByRole('button', { name: 'Save favorite' }));
        await waitFor(() => expect(data[1].name).toBe('Renamed'));
        await userEvent.click(screen.getByRole('button', { name: 'Edit Renamed' }));
        await userEvent.click(screen.getByRole('checkbox', { name: 'G' }));
        await userEvent.click(screen.getByRole('button', { name: 'Save favorite' }));
        await waitFor(() => expect(data[1].groups).toBeUndefined());
        await userEvent.click(screen.getByRole('button', { name: 'Edit Site 13' }));
        expect((screen.getByRole('checkbox', { name: 'G (full)' }) as HTMLInputElement).disabled).toBe(true);
    });

    it('blocks saving a kept pending list that grows a group past the latest limit', async () => {
        groupNames = ['G'];
        data = sites(11, ['G']);
        await readyWith('Site 1');
        conflict = true;
        conflictStore = { revision: 7, favorites: sites(10, ['G'], 2), groups: ['G'] };
        await userEvent.click(screen.getByRole('button', { name: 'Edit Site 1' }));
        await userEvent.type(screen.getByLabelText('Name'), ' edited');
        await userEvent.click(screen.getByRole('button', { name: 'Save favorite' }));
        await userEvent.click(await screen.findByRole('button', { name: 'Keep pending list for review' }));
        await userEvent.click(screen.getAllByRole('button', { name: 'Close editor' })[0]);
        conflict = false;
        const puts = requests.filter((request) => request.body).length;
        await userEvent.click(screen.getByRole('button', { name: 'Save pending list' }));
        await screen.findByText('G can hold at most 10 sites. Remove sites from it before saving.');
        expect(requests.filter((request) => request.body).length).toBe(puts);
    });
});

describe('embedded app token handoff', () => {
    const ask = (
        frame: HTMLIFrameElement,
        data: unknown,
        origin = 'https://example.com',
        source: MessageEventSource | null = frame.contentWindow
    ) => fireEvent(window, new MessageEvent('message', { data, origin, source }));
    it('saves, returns, and clears a token only for the frame at its saved origin', async () => {
        await ready();
        const frame = screen.getByTitle('Example') as HTMLIFrameElement;
        const reply = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => undefined);
        ask(frame, { type: 'sitedock:token', op: 'save', id: 'a', token: 'secret' });
        expect(reply).toHaveBeenLastCalledWith({ type: 'sitedock:token', op: 'ok', id: 'a' }, 'https://example.com');
        expect(localStorage.getItem('sitedock-token:https://example.com')).toBe('secret');
        ask(frame, { type: 'sitedock:token', op: 'get', id: 'b' });
        expect(reply).toHaveBeenLastCalledWith(
            { type: 'sitedock:token', op: 'value', id: 'b', token: 'secret' },
            'https://example.com'
        );
        ask(frame, { type: 'sitedock:token', op: 'clear', id: 'c' });
        expect(localStorage.getItem('sitedock-token:https://example.com')).toBeNull();
    });
    it('ignores token messages from the wrong origin, a non-frame source, or with bad data', async () => {
        await ready();
        const frame = screen.getByTitle('Example') as HTMLIFrameElement;
        localStorage.setItem('sitedock-token:https://example.com', 'secret');
        const reply = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => undefined);
        ask(frame, { type: 'sitedock:token', op: 'get', id: 'x' }, 'https://evil.example');
        ask(frame, { type: 'sitedock:token', op: 'get', id: 'x' }, 'https://example.com', window);
        ask(frame, { type: 'sitedock:token', op: 'get', id: 'x' }, 'https://example.com', null);
        for (const data of [
            null,
            'get',
            { type: 'sitedock:token', op: 'get' },
            { type: 'sitedock:token', op: 'dump', id: 'x' },
            { type: 'sitedock:token', op: 'save', id: 'x', token: '' },
            { type: 'sitedock:token', op: 'save', id: 'x', token: 'x'.repeat(4097) },
            { type: 'sitedock:token', op: 'save', id: 'x', token: 7 },
        ])
            ask(frame, data);
        expect(reply).not.toHaveBeenCalled();
        expect(localStorage.getItem('sitedock-token:https://example.com')).toBe('secret');
    });
    it('lets the owner forget a saved token from the favorite editor', async () => {
        await ready();
        localStorage.setItem('sitedock-token:https://example.com', 'secret');
        await userEvent.click(screen.getByRole('button', { name: 'Edit Example' }));
        await userEvent.click(screen.getByRole('button', { name: 'Forget saved sign-in' }));
        expect(localStorage.getItem('sitedock-token:https://example.com')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Forget saved sign-in' })).toBeNull();
    });
});

describe('modal initial focus by device', () => {
    const devices = [
        {
            label: 'desktop',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            platform: 'Win32',
            touches: 0,
            ios: false,
        },
        {
            label: 'iPhone',
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
            platform: 'iPhone',
            touches: 5,
            ios: true,
        },
        {
            label: 'iPad with desktop identity',
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
            platform: 'MacIntel',
            touches: 5,
            ios: true,
        },
    ];
    function useDevice(userAgent: string, platform: string, touches: number) {
        vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
        vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
        vi.stubGlobal('navigator', Object.create(navigator, { maxTouchPoints: { value: touches } }));
    }
    afterEach(() => vi.restoreAllMocks());

    it.each(devices)(
        'focuses the right element when modals open on $label',
        async ({ userAgent, platform, touches, ios }) => {
            useDevice(userAgent, platform, touches);
            await ready();
            const edit = screen.getByRole('button', { name: 'Edit Example' });
            await userEvent.click(edit);
            let modal = screen.getByRole('dialog', { name: 'Edit favorite' });
            const name = within(modal).getByLabelText('Name', { exact: true });
            expect(document.activeElement).toBe(
                ios ? within(modal).getByRole('heading', { name: 'Edit favorite' }) : name
            );
            await userEvent.click(name);
            expect(document.activeElement).toBe(name);
            await userEvent.type(name, ' tapped');
            expect((name as HTMLInputElement).value).toBe('Example tapped');
            fireEvent(modal, new Event('cancel', { cancelable: true }));
            expect(document.activeElement).toBe(edit);

            await userEvent.click(screen.getByRole('combobox', { name: 'Group' }));
            await userEvent.click(screen.getByRole('option', { name: 'Create group...' }));
            modal = screen.getByRole('dialog', { name: 'Create group' });
            const group = within(modal).getByLabelText('Group name');
            expect(document.activeElement).toBe(
                ios ? within(modal).getByRole('heading', { name: 'Create group' }) : group
            );
            await userEvent.click(group);
            expect(document.activeElement).toBe(group);
            await userEvent.click(within(modal).getByRole('button', { name: 'Cancel' }));

            fireEvent.keyDown(window, { code: 'KeyG', key: 'g', altKey: true });
            modal = await screen.findByRole('dialog', { name: 'Switch group' });
            const filter = within(modal).getByRole('combobox', { name: 'Filter groups' });
            expect(document.activeElement).toBe(
                ios ? within(modal).getByRole('heading', { name: 'Switch group' }) : filter
            );
            await userEvent.click(filter);
            expect(document.activeElement).toBe(filter);
        }
    );
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import type { Favorite } from './model';

const favorites: Favorite[] = [
  { id: 'one', name: 'Example', url: 'https://example.com/', mode: 'embed' },
  { id: 'two', name: 'Other', url: 'https://example.org/', mode: 'embed' },
  { id: 'three', name: 'News', url: 'https://news.example.com/', mode: 'external' },
];
let authenticated: boolean;
let revision: number;
let data: Favorite[];
let conflict: boolean;
let requests: Array<{ path: string; body?: Record<string, unknown> }>;
let failSave: boolean;
let groupNames: string[];

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  authenticated = true; revision = 1; data = favorites.map(item => ({ ...item })); conflict = false; failSave = false; requests = [];
  groupNames = [];
  const preferences = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => preferences.get(key) ?? null,
    setItem: (key: string, value: string) => preferences.set(key, value),
    removeItem: (key: string) => preferences.delete(key),
    clear: () => preferences.clear(),
  });
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('fetch', vi.fn(async (input: string, options: RequestInit) => {
    const body = options.body ? JSON.parse(String(options.body)) as Record<string, unknown> : undefined;
    requests.push({ path: input, body });
    let value: unknown = {};
    let status = 200;
    if (input === '/api/session') value = { authenticated, username: 'owner', allowedOrigins: ['https://dock.example.com'] };
    if (input === '/api/login') { authenticated = true; value = { authenticated: true }; }
    if (input === '/api/logout') { authenticated = false; }
    if (input === '/api/favorites') {
      if (!authenticated) { status = 401; value = { error: 'Session expired' }; }
      else if (body && conflict) { status = 409; value = { revision: 7, favorites: [{ ...favorites[0], name: 'Changed elsewhere' }], groups: ['News'], error: 'Conflict' }; }
      else if (body && failSave) { status = 500; value = { error: 'Disk unavailable' }; }
      else { if (body) { data = body.favorites as Favorite[]; groupNames = body.groups as string[]; revision++; } value = { revision, favorites: data, groups: groupNames }; }
    }
    return new Response(JSON.stringify(value), { status });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function ready() { render(<App />); await screen.findByTitle('Example'); }

describe('dashboard sessions and embedded pages', () => {
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
    await waitFor(() => expect(data.map(favorite => favorite.id)).toEqual(['three', 'two', 'one']));
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
    await screen.findByText('The group could not be saved. Retry, or cancel to review the pending changes on the dashboard.');
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
    await screen.findByText('The group could not be saved. Retry, or cancel to review the pending changes on the dashboard.');
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
    expect(logo.textContent).toBe('S');
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
      { code: 'Digit2' }, { code: 'Digit2', altKey: true, ctrlKey: true }, { key: '2', ctrlKey: true },
      { code: 'Digit2', altKey: true, shiftKey: true }, { code: 'Digit2', altKey: true, metaKey: true }, { code: 'Digit2', altKey: true, repeat: true },
      { code: 'Digit0', altKey: true }, { code: 'Digit9', altKey: true }, { code: 'Numpad0', altKey: true }, { code: 'Numpad9', altKey: true },
    ]) expect(fireEvent.keyDown(window, properties)).toBe(true);
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
    const options = () => screen.getAllByRole('option').filter(option => hud.contains(option));
    expect(options().map(option => option.textContent)).toEqual(['All sites3', 'Personal2', 'Sports1']);
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
    expect(options().map(option => option.textContent)).toEqual(['Sports1']);
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
    const post = (data: unknown, origin = 'https://example.com', source: MessageEventSource | null = frame.contentWindow) =>
      fireEvent(window, new MessageEvent('message', { data, origin, source }));
    post({ type: 'sitedock:key', code: 'Digit2' }, 'https://evil.example');
    post({ type: 'sitedock:key', code: 'Digit2' }, 'https://example.com', window);
    post({ type: 'sitedock:key', code: 'Digit2' }, 'https://example.com', null);
    for (const data of [null, 'Digit2', { type: 'other', code: 'Digit2' }, { type: 'sitedock:key', code: 'Digit0' },
      { type: 'sitedock:key', code: 'Digit22' }, { type: 'sitedock:key', code: 2 }, { type: 'sitedock:key', code: 'KeyH' }]) post(data);
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
    const activate = vi.spyOn(external, 'click').mockImplementation(() => { external.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    fireEvent(window, new MessageEvent('message', { data: { type: 'sitedock:key', code: 'Digit3' }, origin: 'https://example.com', source: frame.contentWindow }));
    expect(activate).toHaveBeenCalledOnce();
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Open News'));
  });
  it('retains visited frames and reloads only the selected frame from its configured URL', async () => {
    await ready();
    const first = screen.getByTitle('Example');
    expect(first.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox');
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
    expect(requests.some(request => request.path === '/api/logout')).toBe(true);
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
    expect(requests.find(request => request.path === '/api/login')?.body).toEqual({ username: 'owner', password: 'a long password' });
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
    expect(requests.some(request => request.body?.favorites)).toBe(false);
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
    await waitFor(() => expect(screen.getByTitle('New site').getAttribute('src')).toBe('https://updated.example.com/'));
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
    const writesBefore = requests.filter(request => request.body?.favorites).length;
    await userEvent.click(screen.getByRole('button', { name: 'Keep pending list for review' }));
    expect(requests.filter(request => request.body?.favorites)).toHaveLength(writesBefore);
    conflict = false;
    await userEvent.click(screen.getByRole('button', { name: 'Save favorite' }));
    await screen.findByRole('button', { name: 'Edit My pending name' });
    expect(requests.filter(request => request.body?.favorites).at(-1)?.body?.baseRevision).toBe(7);
  });
  it('keeps form fields when storage fails and retries the pending edit', async () => {
    await ready(); failSave = true;
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
    await screen.findByText('SiteDock cannot be added to its own favorites.');
    expect(requests.some(request => request.body?.favorites)).toBe(false);
  });
  it('saves keyboard reorder intent with the full list', async () => {
    await ready();
    const button = screen.getByRole('button', { name: 'Move Example down' });
    button.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(requests.some(request => request.body?.operation === 'reorder')).toBe(true));
    expect(data.map(item => item.id)).toEqual(['two', 'one', 'three']);
  });
  it('uses arrow controls without drag handles or draggable rows', async () => {
    await ready();
    expect(document.querySelector('.drag-grip')).toBeNull();
    expect(document.querySelector('[draggable="true"]')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Move Example down' }));
    await waitFor(() => expect(data.map(item => item.id)).toEqual(['two', 'one', 'three']));
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
    await userEvent.click(screen.getByRole('combobox', { name: 'Theme' }));
    await userEvent.click(screen.getByRole('option', { name: 'Light' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('sitedock.theme')).toBe('light');
  });
});

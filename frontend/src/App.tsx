import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
    api,
    ApiError,
    clampWidth,
    GROUP_LIMIT,
    groupCapViolation,
    isExternal,
    moveFavorite,
    readPreference,
    savePreference,
    shortcutKey,
    validateUrl,
    type Favorite,
    type Session,
    type Store,
    type Theme,
} from './model';
import { Icon } from './Icon';
import { useTheme } from './useTheme';
import { Dropdown } from './Dropdown';
import { DeleteFavoriteDialog } from './DeleteFavoriteDialog';
import { forgetMissingIcons, SiteIcon } from './SiteIcon';
import { CreateGroupDialog } from './CreateGroupDialog';
import { GroupHud } from './GroupHud';
import { ReorderGroupsDialog } from './ReorderGroupsDialog';
import { Hint, InfoBox } from './InfoBox';
import { forgetOrphanedTokens, handleTokenRequest, originOf, parseTokenRequest, readToken, writeToken } from './tokens';

const localOrigins = ['localhost', '127.0.0.1', '[::1]'].flatMap((host) =>
    [8790, 5173].map((port) => `http://${host}:${port}`)
);
const ownOrigins = [
    ...localOrigins,
    location.origin,
    ...(import.meta.env.VITE_SITE_ORIGINS ?? '')
        .split(',')
        .map((value: string) => value.trim())
        .filter(Boolean),
];
const message = (error: unknown) => (error instanceof Error ? error.message : 'The request failed. Please try again.');
type Frame = { id: string; url: string; version: number };
type Command = { kind: 'favorite'; index: number } | { kind: 'hud' };
const editableTarget =
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="combobox"][aria-expanded="true"], [role="listbox"], dialog';

function commandForCode(code: unknown): Command | null {
    if (typeof code !== 'string') return null;
    if (code === 'KeyG') return { kind: 'hud' };
    const digit = /^(?:Digit|Numpad)([0-9])$/.exec(code);
    return digit ? { kind: 'favorite', index: digit[1] === '0' ? 9 : Number(digit[1]) - 1 } : null;
}

function keyCommand(event: KeyboardEvent): Command | null {
    if (
        !event.altKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.metaKey ||
        event.repeat ||
        event.isComposing ||
        event.defaultPrevented
    )
        return null;
    if (event.getModifierState?.('AltGraph')) return null;
    return commandForCode(event.code);
}

function Conflict({ current, accept, discard }: { current: Store; accept: () => void; discard: () => void }) {
    return (
        <section className="conflict" aria-label="Concurrent changes">
            <strong>Another browser changed your favorites.</strong>
            <p>Your pending list and form are still here. Latest revision {current.revision}:</p>
            <p>Groups: {current.groups?.join(', ') || 'None'}</p>
            <ol>
                {current.favorites.map((item) => (
                    <li key={item.id}>
                        {item.name}{' '}
                        <small>
                            {item.url} · {item.mode} · {item.groups?.join(', ') || 'No groups'}
                        </small>
                    </li>
                ))}
            </ol>
            {current.favorites.length === 0 && <p>The latest list is empty.</p>}
            <p>
                Compare the lists before continuing. Keeping your list will replace the latest list on your next save,
                including additions or deletions from another browser.
            </p>
            <div className="button-row">
                <button type="button" onClick={accept}>
                    Keep pending list for review
                </button>
                <button type="button" onClick={discard}>
                    Use latest list
                </button>
            </div>
        </section>
    );
}

function FavoriteForm({
    favorite,
    groups,
    draft,
    committed,
    busy,
    blocked,
    allowedOrigins,
    feedback,
    onSave,
    onClose,
}: {
    favorite: Favorite;
    groups: string[];
    draft: Favorite[];
    committed: Favorite[];
    busy: boolean;
    blocked: boolean;
    allowedOrigins: string[];
    feedback: ReactNode;
    onSave: (favorite: Favorite) => Promise<void>;
    onClose: () => void;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    const nameInput = useRef<HTMLInputElement>(null);
    const returnFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const title = useId();
    useEffect(() => {
        const target = returnFocus.current;
        const element = dialog.current!;
        element.showModal();
        nameInput.current?.focus();
        return () => {
            element.close();
            if (target?.isConnected) target.focus();
        };
    }, []);
    const [name, setName] = useState(favorite.name);
    const [url, setUrl] = useState(favorite.url);
    const [mode, setMode] = useState(favorite.mode);
    const [selectedGroups, setSelectedGroups] = useState(favorite.groups ?? []);
    const [error, setError] = useState('');
    const savedGroups = committed.find((item) => item.id === favorite.id)?.groups ?? [];
    const isFull = (group: string) =>
        !savedGroups.includes(group) &&
        draft.filter((item) => item.id !== favorite.id && item.groups?.includes(group)).length >= GROUP_LIMIT;
    const overfilled = selectedGroups.filter(isFull);
    const tokenOrigin = originOf(favorite.url);
    const [hasToken, setHasToken] = useState(() => !!tokenOrigin && readToken(tokenOrigin) !== null);
    async function submit(event: FormEvent) {
        event.preventDefault();
        setError('');
        try {
            if (!name.trim() || name.trim().length > 100) throw new Error('Use a name between 1 and 100 characters.');
            if (selectedGroups.some((group) => !groups.includes(group)))
                throw new Error('A selected group is no longer available. Clear it before saving.');
            if (overfilled.length)
                throw new Error(
                    `${overfilled[0]} already has ${GROUP_LIMIT} sites. Clear it or remove a site from it first.`
                );
            await onSave({
                id: favorite.id,
                name: name.trim(),
                url: validateUrl(url, allowedOrigins),
                mode,
                ...(selectedGroups.length ? { groups: selectedGroups } : {}),
            });
        } catch (cause) {
            setError(message(cause));
        }
    }
    return createPortal(
        <dialog
            ref={dialog}
            className="confirmation-modal editor"
            aria-labelledby={title}
            onCancel={(event) => {
                event.preventDefault();
                if (!busy) onClose();
            }}
        >
            <div className="section-heading">
                <h2 id={title}>{favorite.name ? 'Edit favorite' : 'Add favorite'}</h2>
                <button type="button" aria-label="Close editor" onClick={onClose} disabled={busy}>
                    <Icon name="close" />
                </button>
            </div>
            <form onSubmit={(event) => void submit(event)}>
                <label>
                    Name
                    <input
                        ref={nameInput}
                        autoFocus
                        maxLength={100}
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        required
                    />
                </label>
                <label>
                    Website address
                    <input
                        type="url"
                        maxLength={2048}
                        placeholder="https://example.com/"
                        value={url}
                        onChange={(event) => setUrl(event.target.value)}
                        required
                    />
                </label>
                <fieldset className="favorite-groups" disabled={busy}>
                    <legend>
                        <span className="field-heading">
                            Groups
                            <InfoBox heading="Group membership">
                                Select every group this site belongs to. Sites with no groups appear in All sites. Each
                                group holds up to {GROUP_LIMIT} sites.
                            </InfoBox>
                        </span>
                    </legend>
                    {[...groups, ...selectedGroups.filter((group) => !groups.includes(group))].map((group) => {
                        const checked = selectedGroups.includes(group);
                        const full = isFull(group);
                        return (
                            <label key={group}>
                                <input
                                    type="checkbox"
                                    checked={checked}
                                    disabled={full && !checked}
                                    onChange={(event) =>
                                        setSelectedGroups((previous) =>
                                            event.target.checked
                                                ? [...previous, group]
                                                : previous.filter((value) => value !== group)
                                        )
                                    }
                                />
                                <span>
                                    {group}
                                    {!groups.includes(group) && ' (no longer available)'}
                                    {full && !checked && ' (full)'}
                                </span>
                            </label>
                        );
                    })}
                    {overfilled.length > 0 && (
                        <p className="error">
                            {overfilled.join(', ')} already {overfilled.length === 1 ? 'has' : 'have'} {GROUP_LIMIT}{' '}
                            sites. Clear {overfilled.length === 1 ? 'it' : 'them'} to save.
                        </p>
                    )}
                    {!groups.length && !selectedGroups.length && (
                        <p className="muted">Create groups from the sidebar dropdown first.</p>
                    )}
                </fieldset>
                <div className="dropdown-field">
                    <span className="field-heading">
                        Open preference
                        <InfoBox heading="Opening sites">
                            Some sites block embedding or require a separate tab for sign-in. HTTP sites always open
                            separately when Site Dock uses HTTPS.
                        </InfoBox>
                    </span>
                    <Dropdown
                        label="Open preference"
                        value={mode}
                        onChange={setMode}
                        options={[
                            { value: 'embed', label: 'Inside Site Dock' },
                            { value: 'external', label: 'Separate tab' },
                        ]}
                    />
                </div>
                {hasToken && tokenOrigin && (
                    <div className="saved-token">
                        <span className="muted">This browser keeps a sign-in token for {tokenOrigin}.</span>
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                                if (writeToken(tokenOrigin, null)) setHasToken(false);
                            }}
                        >
                            Forget saved sign-in
                        </button>
                    </div>
                )}
                {error && (
                    <p role="alert" className="error">
                        {error}
                    </p>
                )}
                {feedback}
                <div className="button-row">
                    <button type="submit" className="primary" disabled={busy || blocked}>
                        {busy ? 'Saving…' : 'Save favorite'}
                    </button>
                    <button type="button" onClick={onClose} disabled={busy}>
                        Close editor
                    </button>
                </div>
            </form>
        </dialog>,
        document.body
    );
}

export function App() {
    const [theme, setTheme] = useTheme();
    const [session, setSession] = useState<Session | null>(null);
    const [store, setStore] = useState<Store | null>(null);
    const [draft, setDraft] = useState<Favorite[]>([]);
    const [groups, setGroups] = useState<string[]>([]);
    const [groupFilter, setGroupFilter] = useState(() => {
        const saved = readPreference('group', 'all');
        return saved === 'ungrouped' ? 'all' : saved;
    });
    const [creatingGroup, setCreatingGroup] = useState(false);
    const [reorderingGroups, setReorderingGroups] = useState(false);
    const [pending, setPending] = useState(false);
    const [conflict, setConflict] = useState<Store | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [selected, setSelected] = useState(() => readPreference('selected'));
    const [width, setWidth] = useState(() => clampWidth(Number(readPreference('width', '280'))));
    const [sidebar, setSidebar] = useState(false);
    const [minimized, setMinimized] = useState(() => readPreference('sidebar-minimized') === 'true');
    const [resizing, setResizing] = useState(false);
    const [editor, setEditor] = useState<Favorite | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<Favorite | null>(null);
    const [frames, setFrames] = useState<Frame[]>([]);
    const [loadedFrames, setLoadedFrames] = useState<ReadonlySet<string>>(() => new Set());
    const [announcement, setAnnouncement] = useState('');
    const [loadAttempt, setLoadAttempt] = useState(0);
    const generation = useRef(0);
    const requestNumber = useRef(0);
    const auth = useRef(false);
    const saving = useRef(false);
    const resizeOrigin = useRef({ x: 0, width: 280 });
    const favoriteControls = useRef(new Map<string, HTMLButtonElement | HTMLAnchorElement>());
    const frameElements = useRef(new Map<string, HTMLIFrameElement>());
    // Safari blocks a first sign-in inside a frame. After the user signs in through Open tab,
    // reloading the frame on return picks up the new same-site cookie.
    const reloadOnReturn = useRef(new Set<string>());
    const [iconRetry, setIconRetry] = useState(0);
    const openLink = useRef<HTMLAnchorElement>(null);
    const focusOpenLink = useRef(false);
    const hudReturn = useRef<HTMLElement | null>(null);
    const [hudOpen, setHudOpen] = useState(false);
    const visibleFavorites = useMemo(
        () => draft.filter((favorite) => groupFilter === 'all' || favorite.groups?.includes(groupFilter.slice(6))),
        [draft, groupFilter]
    );
    const current = draft.find((item) => item.id === selected);

    // Native keys and forwarded iframe messages share this dispatcher, which re-checks auth and modal state.
    function runCommand(command: Command, forwarded: boolean) {
        if (!auth.current || editor || deleteTarget || creatingGroup || reorderingGroups || hudOpen) return false;
        focusOpenLink.current = false;
        if (command.kind === 'hud') {
            const frame = forwarded && current ? frameElements.current.get(current.id) : undefined;
            hudReturn.current =
                frame ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
            if (forwarded) window.focus();
            setHudOpen(true);
            return true;
        }
        const favorite = visibleFavorites[command.index];
        const control = favorite && favoriteControls.current.get(favorite.id);
        if (!control) return false;
        if (forwarded) {
            window.focus();
            control.focus();
        }
        control.click();
        // A forwarded key carries no user activation, so the browser may block the new tab.
        if (forwarded && isExternal(favorite)) focusOpenLink.current = true;
        return true;
    }
    const latest = useRef({ runCommand, current, hudOpen, draft });
    latest.current = { runCommand, current, hudOpen, draft };

    useEffect(() => {
        if (!session?.authenticated) return;
        function shortcut(event: KeyboardEvent) {
            const command = keyCommand(event);
            if (!command || latest.current.hudOpen) return;
            if (event.target instanceof Element && event.target.closest(editableTarget)) return;
            if (latest.current.runCommand(command, false)) event.preventDefault();
        }
        function forwarded(event: MessageEvent) {
            const data: unknown = event.data;
            if (!data || typeof data !== 'object' || (data as { type?: unknown }).type !== 'sitedock:key') return;
            const command = commandForCode((data as { code?: unknown }).code);
            const favorite = latest.current.current;
            if (!command || !favorite || isExternal(favorite)) return;
            const frame = frameElements.current.get(favorite.id);
            if (!frame?.contentWindow || event.source !== frame.contentWindow) return;
            let origin: string;
            try {
                origin = new URL(favorite.url).origin;
            } catch {
                return;
            }
            if (event.origin !== origin) return;
            latest.current.runCommand(command, true);
        }
        // Any mounted frame may ask, since apps request their token as soon as they load, even when hidden.
        function tokenMessage(event: MessageEvent) {
            const request = parseTokenRequest(event.data);
            if (!request || !event.source || !auth.current) return;
            for (const [id, frame] of frameElements.current) {
                if (!frame.contentWindow || event.source !== frame.contentWindow) continue;
                const favorite = latest.current.draft.find((item) => item.id === id);
                const origin = favorite && !isExternal(favorite) ? originOf(favorite.url) : null;
                // A same-origin frame could read SiteDock's storage directly, so it gets no token service.
                if (!origin || event.origin !== origin || origin === location.origin) return;
                frame.contentWindow.postMessage(handleTokenRequest(request, origin), origin);
                return;
            }
        }
        window.addEventListener('keydown', shortcut);
        window.addEventListener('message', forwarded);
        window.addEventListener('message', tokenMessage);
        return () => {
            window.removeEventListener('keydown', shortcut);
            window.removeEventListener('message', forwarded);
            window.removeEventListener('message', tokenMessage);
        };
    }, [session?.authenticated]);

    useEffect(() => {
        const returned = () => {
            if (document.visibilityState === 'hidden' || reloadOnReturn.current.size === 0) return;
            const ids = reloadOnReturn.current;
            reloadOnReturn.current = new Set();
            setFrames((previous) =>
                previous.map((frame) => (ids.has(frame.id) ? { ...frame, version: frame.version + 1 } : frame))
            );
            forgetMissingIcons();
            setIconRetry((value) => value + 1);
        };
        window.addEventListener('focus', returned);
        document.addEventListener('visibilitychange', returned);
        return () => {
            window.removeEventListener('focus', returned);
            document.removeEventListener('visibilitychange', returned);
        };
    }, []);

    useEffect(() => {
        if (!focusOpenLink.current || !current || !isExternal(current)) return;
        focusOpenLink.current = false;
        openLink.current?.focus();
    });

    function clearSession(reason = '') {
        generation.current++;
        auth.current = false;
        saving.current = false;
        setSession({ authenticated: false });
        setStore(null);
        setDraft([]);
        setGroups([]);
        setCreatingGroup(false);
        setReorderingGroups(false);
        setHudOpen(false);
        setFrames([]);
        setEditor(null);
        setDeleteTarget(null);
        setConflict(null);
        setPending(false);
        setBusy(false);
        setSidebar(false);
        setResizing(false);
        setError(reason);
    }

    async function checkSession() {
        const request = ++requestNumber.current;
        const epoch = generation.current;
        try {
            const result = await api<Session>('session');
            if (request !== requestNumber.current || epoch !== generation.current) return;
            if (!result.authenticated) {
                clearSession(auth.current ? 'Your session ended. Sign in again.' : '');
                return;
            }
            auth.current = true;
            setSession(result);
        } catch (cause) {
            if (request === requestNumber.current && epoch === generation.current) {
                if (cause instanceof ApiError && cause.status === 401)
                    clearSession('Your session ended. Sign in again.');
                else setError(`Could not check your session. ${message(cause)}`);
            }
        }
    }

    useEffect(() => {
        void checkSession();
        const focus = () => {
            if (document.visibilityState !== 'hidden') void checkSession();
        };
        window.addEventListener('focus', focus);
        document.addEventListener('visibilitychange', focus);
        return () => {
            window.removeEventListener('focus', focus);
            document.removeEventListener('visibilitychange', focus);
            // Bumping the counter on cleanup is deliberate: it cancels any session check still in flight.
            // eslint-disable-next-line react-hooks/exhaustive-deps
            requestNumber.current++;
        };
        // Session checks use refs to avoid replacing a pending edit on window focus.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!session?.authenticated) return;
        let active = true;
        const epoch = generation.current;
        void api<Store>('favorites')
            .then((result) => {
                if (active && epoch === generation.current) {
                    setStore(result);
                    setDraft(result.favorites);
                    setGroups(result.groups ?? []);
                    setError('');
                }
            })
            .catch((cause) => {
                if (!active || epoch !== generation.current) return;
                if (cause instanceof ApiError && cause.status === 401)
                    clearSession('Your session ended. Sign in again.');
                else setError(`Could not load favorites. ${message(cause)}`);
            });
        return () => {
            active = false;
        };
        // Only authentication transitions load the shared list.
    }, [session?.authenticated, loadAttempt]);

    useEffect(() => {
        if (!session?.authenticated || !store) return;
        const next = visibleFavorites.some((item) => item.id === selected) ? selected : (visibleFavorites[0]?.id ?? '');
        if (next !== selected) setSelected(next);
        savePreference('selected', next);
        setFrames((previous) => {
            const kept = previous.filter((frame) =>
                draft.some((item) => item.id === frame.id && item.url === frame.url && !isExternal(item))
            );
            const current = draft.find((item) => item.id === next);
            if (current && !isExternal(current) && !kept.some((frame) => frame.id === current.id))
                return [...kept, { id: current.id, url: current.url, version: 0 }];
            return kept;
        });
    }, [draft, visibleFavorites, selected, session?.authenticated, store]);

    useEffect(() => {
        if (!store) return;
        if (groupFilter !== 'all' && !groups.includes(groupFilter.slice(6))) {
            setGroupFilter('all');
            savePreference('group', 'all');
        }
    }, [store, groups, groupFilter]);

    useEffect(() => {
        savePreference('width', String(width));
    }, [width]);
    useEffect(() => {
        if (!resizing) return;
        const end = () => setResizing(false);
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
        return () => {
            window.removeEventListener('pointerup', end);
            window.removeEventListener('pointercancel', end);
        };
    }, [resizing]);

    async function save(next: Favorite[], operation?: 'reorder', nextGroups = groups): Promise<boolean> {
        if (!store || conflict || saving.current || !auth.current) return false;
        const full = groupCapViolation(next, store.favorites);
        if (full) {
            setError(`${full} can hold at most ${GROUP_LIMIT} sites. Remove sites from it before saving.`);
            return false;
        }
        saving.current = true;
        setDraft(next);
        setGroups(nextGroups);
        setPending(true);
        setBusy(true);
        setError('');
        const epoch = generation.current;
        try {
            const result = await api<Store>('favorites', {
                baseRevision: store.revision,
                favorites: next,
                groups: nextGroups,
                ...(operation ? { operation } : {}),
            });
            if (epoch !== generation.current) return false;
            setStore(result);
            setDraft(result.favorites);
            setGroups(result.groups ?? []);
            setPending(false);
            setAnnouncement('Favorites saved.');
            forgetOrphanedTokens(store.favorites, result.favorites);
            return true;
        } catch (cause) {
            if (epoch !== generation.current) return false;
            if (cause instanceof ApiError && cause.status === 401) clearSession('Your session ended. Sign in again.');
            else if (cause instanceof ApiError && cause.status === 409 && cause.store) {
                setConflict(cause.store);
                setError('Review the concurrent changes before saving again.');
            } else setError(`Changes are still pending. ${message(cause)}`);
            return false;
        } finally {
            if (epoch === generation.current) {
                setBusy(false);
                saving.current = false;
            }
        }
    }

    function choose(id: string) {
        setSelected(id);
        setSidebar(false);
    }
    function filterGroup(value: string) {
        setGroupFilter(value);
        savePreference('group', value);
    }
    function reorder(id: string, target: number) {
        const reordered = moveFavorite(visibleFavorites, id, target);
        if (reordered !== visibleFavorites) {
            const visibleIds = new Set(visibleFavorites.map((favorite) => favorite.id));
            let position = 0;
            const next = draft.map((favorite) => (visibleIds.has(favorite.id) ? reordered[position++] : favorite));
            setAnnouncement(`${draft.find((item) => item.id === id)?.name} moved to position ${target + 1}.`);
            void save(next, pending ? undefined : 'reorder');
        }
    }
    async function logout() {
        requestNumber.current++;
        clearSession();
        try {
            await api('logout', {});
        } catch (cause) {
            setError(
                `The dashboard is cleared, but server sign-out could not be confirmed. Retry sign-out before leaving this browser. ${message(cause)}`
            );
        }
    }
    const conflictPanel = conflict && (
        <Conflict
            current={conflict}
            accept={() => {
                setStore(conflict);
                setConflict(null);
                setError('Pending list retained. Review it, then save to replace the latest server list.');
            }}
            discard={() => {
                setStore(conflict);
                setDraft(conflict.favorites);
                setGroups(conflict.groups ?? []);
                setPending(false);
                setConflict(null);
                setError('Latest list loaded. Unsaved form input is still available.');
            }}
        />
    );
    const themeControl = (
        <div className="theme-control">
            <span>Theme</span>
            <Dropdown<Theme>
                label="Theme"
                value={theme}
                onChange={setTheme}
                options={[
                    { value: 'system', label: 'System' },
                    { value: 'light', label: 'Light' },
                    { value: 'midnight', label: 'Midnight' },
                ]}
            />
        </div>
    );

    if (!session?.authenticated)
        return (
            <div className="login-page">
                <header className="login-header">
                    <span className="wordmark">
                        <span className="brand-mark">
                            <img className="brand-icon" src="/favicon.svg" alt="" />
                        </span>
                        Site Dock
                    </span>
                    {themeControl}
                </header>
                <main className="login-card">
                    <p className="eyebrow">YOUR SITES, ONE PLACE</p>
                    <h1>Your everyday dock.</h1>
                    <p className="muted">
                        Sign in to your shared favorites. Your sites keep their own accounts and sign-ins.
                    </p>
                    {error && (
                        <div role="alert" className="error">
                            {error}
                        </div>
                    )}
                    {session === null ? (
                        <>
                            <p role="status">Checking your session…</p>
                            {error && <button onClick={() => void checkSession()}>Retry connection</button>}
                        </>
                    ) : (
                        <Login
                            onLogin={async (username, password) => {
                                setError('');
                                await api('login', { username, password });
                                await checkSession();
                            }}
                        />
                    )}
                    {error.includes('server sign-out') && <button onClick={() => void logout()}>Retry sign-out</button>}
                    <p className="login-note">Private access · Favorites shared across devices</p>
                </main>
                <footer className="login-footer">
                    Signing out of Site Dock leaves source-site sign-ins unchanged. Sites are not cached for offline
                    use.
                </footer>
            </div>
        );

    return (
        <div
            className={`app ${resizing ? 'interacting' : ''} ${minimized ? 'sidebar-minimized' : ''}`}
            style={{ '--sidebar-width': `${width}px` } as CSSProperties}
        >
            {creatingGroup && (
                <CreateGroupDialog
                    groups={store?.groups ?? []}
                    busy={busy}
                    onCancel={() => setCreatingGroup(false)}
                    onSave={async (name) => {
                        if (await save(draft, undefined, groups.includes(name) ? groups : [...groups, name])) {
                            setCreatingGroup(false);
                            filterGroup(`group:${name}`);
                            setAnnouncement(`Group ${name} created.`);
                            return true;
                        }
                        return false;
                    }}
                />
            )}
            {reorderingGroups && (
                <ReorderGroupsDialog
                    groups={groups}
                    busy={busy}
                    blocked={!!conflict}
                    onCancel={() => setReorderingGroups(false)}
                    onSave={async (nextGroups) => {
                        if (!(await save(draft, undefined, nextGroups))) return false;
                        setReorderingGroups(false);
                        setAnnouncement('Group order saved.');
                        return true;
                    }}
                />
            )}
            {hudOpen && (
                <GroupHud
                    current={groupFilter}
                    returnTo={hudReturn.current}
                    options={[
                        { value: 'all', label: 'All sites', count: draft.length },
                        ...groups.map((name) => ({
                            value: `group:${name}`,
                            label: name,
                            count: draft.filter((favorite) => favorite.groups?.includes(name)).length,
                        })),
                    ]}
                    onClose={() => setHudOpen(false)}
                    onApply={(value) => {
                        setHudOpen(false);
                        filterGroup(value);
                        setAnnouncement(`Showing ${value === 'all' ? 'all sites' : value.slice(6)}.`);
                    }}
                />
            )}
            {deleteTarget && (
                <DeleteFavoriteDialog
                    favorite={deleteTarget}
                    onCancel={() => setDeleteTarget(null)}
                    onConfirm={() => {
                        setDeleteTarget(null);
                        void save(draft.filter((item) => item.id !== deleteTarget.id));
                    }}
                />
            )}
            {sidebar && <button className="scrim" aria-label="Close favorites" onClick={() => setSidebar(false)} />}
            <aside id="favorites-sidebar" className={`sidebar ${sidebar ? 'is-open' : ''}`} aria-label="Favorites">
                <div className="sidebar-brand">
                    <span className="wordmark">
                        <span className="brand-mark mobile-only">
                            <img className="brand-icon" src="/favicon.svg" alt="" />
                        </span>
                        <Hint text={minimized ? 'Expand sidebar' : 'Minimize sidebar'}>
                            <button
                                type="button"
                                className="brand-mark brand-toggle desktop-only"
                                aria-label={minimized ? 'Expand favorites' : 'Minimize favorites'}
                                aria-controls="favorites-sidebar"
                                aria-expanded={!minimized}
                                onClick={() => {
                                    const next = !minimized;
                                    setMinimized(next);
                                    setResizing(false);
                                    savePreference('sidebar-minimized', String(next));
                                }}
                            >
                                <img className="brand-icon" src="/favicon.svg" alt="" />
                            </button>
                        </Hint>
                        Site Dock
                    </span>
                    <button className="mobile-only" aria-label="Close favorites" onClick={() => setSidebar(false)}>
                        <Icon name="close" />
                    </button>
                </div>
                <div className="section-heading list-heading">
                    <span className="eyebrow">
                        FAVORITES <span className="count">{visibleFavorites.length}</span>
                    </span>
                    <button
                        aria-label="Add favorite"
                        disabled={!store || busy}
                        onClick={() => {
                            setEditor({
                                id: crypto.randomUUID(),
                                name: '',
                                url: '',
                                mode: 'embed',
                                ...(groupFilter.startsWith('group:') && visibleFavorites.length < GROUP_LIMIT
                                    ? { groups: [groupFilter.slice(6)] }
                                    : {}),
                            });
                            setSidebar(false);
                        }}
                    >
                        <Icon name="plus" />
                    </button>
                </div>
                <div className="group-filter">
                    <Dropdown
                        label="Group"
                        hint
                        value={groupFilter}
                        options={[
                            { value: 'all', label: 'All sites' },
                            ...groups.map((name) => ({ value: `group:${name}`, label: name })),
                            { value: 'create', label: 'Create group...' },
                            { value: 'reorder', label: 'Reorder groups...' },
                        ]}
                        onChange={(value) => {
                            if (value !== 'create' && value !== 'reorder') {
                                filterGroup(value);
                                return;
                            }
                            if (!store || busy || conflict || pending || editor) {
                                setError('Finish or discard pending edits before creating or reordering groups.');
                                return;
                            }
                            if (value === 'reorder') setReorderingGroups(true);
                            else setCreatingGroup(true);
                        }}
                    />
                    <InfoBox heading="Groups">
                        Choose a group here or press Alt+G to search. Create group adds a group. Reorder groups changes
                        the shared order with up/down buttons; All sites stays first.
                    </InfoBox>
                </div>
                <nav className="favorites-list" aria-label="Favorite websites">
                    {visibleFavorites.map((favorite, index) => {
                        const key = shortcutKey(index);
                        return (
                            <div key={favorite.id} className={`favorite ${selected === favorite.id ? 'selected' : ''}`}>
                                <div className="favorite-main">
                                    <SiteIcon
                                        key={`${favorite.url}:${iconRetry}`}
                                        url={favorite.url}
                                        name={favorite.name}
                                    />
                                    {key && (
                                        <span className="shortcut-pill" aria-hidden="true">
                                            {key}
                                        </span>
                                    )}
                                    {isExternal(favorite) ? (
                                        <Hint text={key ? `${favorite.name} (Alt+${key})` : favorite.name}>
                                            <a
                                                ref={(element) => {
                                                    if (element) favoriteControls.current.set(favorite.id, element);
                                                    else favoriteControls.current.delete(favorite.id);
                                                }}
                                                className="favorite-select"
                                                aria-label={`Open ${favorite.name} in a separate tab`}
                                                aria-keyshortcuts={key ? `Alt+${key}` : undefined}
                                                href={favorite.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                aria-current={selected === favorite.id ? 'page' : undefined}
                                                onClick={() => choose(favorite.id)}
                                            >
                                                <span>{favorite.name}</span>
                                                <small>Separate tab{key && <kbd>Alt+{key}</kbd>}</small>
                                            </a>
                                        </Hint>
                                    ) : (
                                        <Hint text={key ? `${favorite.name} (Alt+${key})` : favorite.name}>
                                            <button
                                                ref={(element) => {
                                                    if (element) favoriteControls.current.set(favorite.id, element);
                                                    else favoriteControls.current.delete(favorite.id);
                                                }}
                                                className="favorite-select"
                                                aria-label={favorite.name}
                                                aria-keyshortcuts={key ? `Alt+${key}` : undefined}
                                                aria-current={selected === favorite.id ? 'page' : undefined}
                                                onClick={() => choose(favorite.id)}
                                            >
                                                <span>{favorite.name}</span>
                                                <small>
                                                    {new URL(favorite.url).hostname}
                                                    {key && <kbd>Alt+{key}</kbd>}
                                                </small>
                                            </button>
                                        </Hint>
                                    )}
                                    {isExternal(favorite) && <Icon name="external" />}
                                </div>
                                <div className="favorite-actions">
                                    <Hint text="Move up">
                                        <button
                                            aria-label={`Move ${favorite.name} up`}
                                            disabled={index === 0 || busy || !!conflict}
                                            onClick={() => reorder(favorite.id, index - 1)}
                                        >
                                            <Icon name="up" />
                                        </button>
                                    </Hint>
                                    <Hint text="Move down">
                                        <button
                                            aria-label={`Move ${favorite.name} down`}
                                            disabled={index === visibleFavorites.length - 1 || busy || !!conflict}
                                            onClick={() => reorder(favorite.id, index + 1)}
                                        >
                                            <Icon name="down" />
                                        </button>
                                    </Hint>
                                    <Hint text="Edit favorite">
                                        <button
                                            aria-label={`Edit ${favorite.name}`}
                                            disabled={busy}
                                            onClick={() => {
                                                setEditor(favorite);
                                                setSidebar(false);
                                            }}
                                        >
                                            <Icon name="edit" />
                                        </button>
                                    </Hint>
                                    <Hint text="Delete favorite">
                                        <button
                                            aria-label={`Delete ${favorite.name}`}
                                            disabled={busy || !!conflict}
                                            onClick={() => setDeleteTarget(favorite)}
                                        >
                                            <Icon name="trash" />
                                        </button>
                                    </Hint>
                                </div>
                            </div>
                        );
                    })}
                    {store && !visibleFavorites.length && (
                        <p className="sidebar-empty">
                            {groupFilter === 'all'
                                ? 'Add your first favorite to get started.'
                                : 'No sites in this group. Add a favorite or edit a site in All sites to assign it here.'}
                        </p>
                    )}
                </nav>
                <footer className="sidebar-footer">
                    {themeControl}
                    <div className="account">
                        <span>
                            <small>{session.gatewayAuthenticated ? 'Access protected' : 'Signed in as'}</small>
                            {session.gatewayAuthenticated ? 'Gateway' : (session.username ?? 'Owner')}
                        </span>
                        {!session.gatewayAuthenticated && (
                            <Hint text="Sign out of Site Dock">
                                <button aria-label="Sign out" onClick={() => void logout()}>
                                    <Icon name="logout" />
                                </button>
                            </Hint>
                        )}
                    </div>
                </footer>
            </aside>
            <div
                role="separator"
                aria-label="Sidebar width"
                aria-orientation="vertical"
                aria-valuemin={220}
                aria-valuemax={480}
                aria-valuenow={width}
                tabIndex={0}
                className="resize-handle"
                onKeyDown={(event) => {
                    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                        event.preventDefault();
                        setWidth((value) =>
                            event.key === 'Home'
                                ? 220
                                : event.key === 'End'
                                  ? 480
                                  : clampWidth(value + (event.key === 'ArrowRight' ? 10 : -10))
                        );
                    }
                }}
                onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    resizeOrigin.current = { x: event.clientX, width };
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setResizing(true);
                }}
                onPointerMove={(event) => {
                    if (resizing)
                        setWidth(clampWidth(resizeOrigin.current.width + event.clientX - resizeOrigin.current.x));
                }}
                onLostPointerCapture={() => setResizing(false)}
                onPointerUp={() => setResizing(false)}
                onPointerCancel={() => setResizing(false)}
            />
            <main className="workspace">
                <header className="workspace-header">
                    <button
                        className="mobile-only"
                        aria-label="Show favorites"
                        aria-controls="favorites-sidebar"
                        aria-expanded={sidebar}
                        onClick={() => setSidebar(true)}
                    >
                        <Icon name="menu" />
                    </button>
                    <div className="site-title">
                        <h1>{current?.name ?? 'Your workspace'}</h1>
                    </div>
                    <div className="toolbar">
                        {current && (
                            <>
                                <Hint text="Reload from the saved address">
                                    <button
                                        disabled={isExternal(current)}
                                        aria-label="Reload selected site"
                                        onClick={() =>
                                            setFrames((previous) =>
                                                previous.map((frame) =>
                                                    frame.id === selected
                                                        ? { ...frame, version: frame.version + 1 }
                                                        : frame
                                                )
                                            )
                                        }
                                    >
                                        <Icon name="reload" />
                                        <span className="toolbar-label">Reload</span>
                                    </button>
                                </Hint>
                                <a
                                    className="button"
                                    href={current.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label={`Open ${current.name} in a new tab`}
                                    onClick={() => {
                                        if (!isExternal(current)) reloadOnReturn.current.add(current.id);
                                    }}
                                >
                                    <Icon name="external" />
                                    <span className="toolbar-label">Open tab</span>
                                </a>
                            </>
                        )}
                    </div>
                </header>
                <div className="notices">
                    {error && !editor && (
                        <p role="alert" className="error">
                            {error}
                        </p>
                    )}
                    {!editor && conflictPanel}
                    {pending && !conflict && (
                        <div className="pending">
                            <span>You have pending changes.</span>
                            <button disabled={busy || !!editor} onClick={() => void save(draft)}>
                                {busy ? 'Saving…' : 'Save pending list'}
                            </button>
                            <button
                                disabled={busy}
                                onClick={() => {
                                    if (store) {
                                        setDraft(store.favorites);
                                        setGroups(store.groups ?? []);
                                        setPending(false);
                                        setError('');
                                    }
                                }}
                            >
                                Discard pending list
                            </button>
                        </div>
                    )}
                    {!store && (
                        <p role="status">
                            Loading favorites…{' '}
                            <button onClick={() => setLoadAttempt((value) => value + 1)}>Retry</button>
                        </p>
                    )}
                    {editor && (
                        <FavoriteForm
                            key={editor.id}
                            favorite={editor}
                            groups={groups}
                            draft={draft}
                            committed={store?.favorites ?? []}
                            busy={busy}
                            blocked={!!conflict}
                            allowedOrigins={[...ownOrigins, ...(session.allowedOrigins ?? [])]}
                            feedback={
                                <>
                                    {error && (
                                        <p role="alert" className="error">
                                            {error}
                                        </p>
                                    )}
                                    {conflictPanel}
                                </>
                            }
                            onClose={() => setEditor(null)}
                            onSave={async (favorite) => {
                                const next = draft.some((item) => item.id === favorite.id)
                                    ? draft.map((item) => (item.id === favorite.id ? favorite : item))
                                    : [...draft, favorite];
                                const full = groupCapViolation(next, store?.favorites ?? []);
                                if (full)
                                    throw new Error(
                                        `${full} already has ${GROUP_LIMIT} sites. Remove a site from it first.`
                                    );
                                if (await save(next)) {
                                    if (groupFilter !== 'all' && !favorite.groups?.includes(groupFilter.slice(6))) {
                                        filterGroup(favorite.groups?.length ? `group:${favorite.groups[0]}` : 'all');
                                    }
                                    setEditor(null);
                                    choose(favorite.id);
                                }
                            }}
                        />
                    )}
                </div>
                <div className="site-area">
                    {frames.map((frame) => {
                        const key = `${frame.id}:${frame.url}:${frame.version}`;
                        const active = selected === frame.id;
                        return (
                            <iframe
                                key={key}
                                ref={(element) => {
                                    if (!element) return;
                                    frameElements.current.set(frame.id, element);
                                    return () => {
                                        if (frameElements.current.get(frame.id) === element)
                                            frameElements.current.delete(frame.id);
                                    };
                                }}
                                title={draft.find((item) => item.id === frame.id)?.name ?? 'Favorite website'}
                                src={frame.url}
                                className={`site-frame${active ? ' active' : ''}${loadedFrames.has(key) ? ' loaded' : ''}`}
                                aria-hidden={active ? undefined : true}
                                inert={!active}
                                onLoad={() =>
                                    setLoadedFrames((previous) =>
                                        previous.has(key) ? previous : new Set(previous).add(key)
                                    )
                                }
                                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                                referrerPolicy="no-referrer"
                            />
                        );
                    })}
                    {current && isExternal(current) && (
                        <section className="empty-state">
                            <div className="state-icon">
                                <Icon name="external" />
                            </div>
                            <p className="eyebrow">SEPARATE TAB</p>
                            <h2>{current.name}</h2>
                            <p>
                                {current.mode === 'embed'
                                    ? 'This site uses HTTP. Your HTTPS connection prevents it from being embedded here.'
                                    : 'This favorite is set to open in a separate browser tab.'}
                            </p>
                            <a
                                ref={openLink}
                                className="button primary"
                                href={current.url}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                <Icon name="external" />
                                Open {current.name}
                            </a>
                            <p className="muted">Your browser may require a separate sign-in.</p>
                        </section>
                    )}
                    {!current && store && (
                        <section className="empty-state">
                            <div className="state-icon">
                                <Icon name="plus" />
                            </div>
                            <p className="eyebrow">MAKE ROOM FOR YOUR ROUTINE</p>
                            <h2>Your sites start here.</h2>
                            <p>Add a favorite, then keep your everyday sites close at hand.</p>
                            <button
                                className="primary"
                                onClick={() => setEditor({ id: crypto.randomUUID(), name: '', url: '', mode: 'embed' })}
                            >
                                <Icon name="plus" />
                                Add favorite
                            </button>
                        </section>
                    )}
                </div>
                {current && !isExternal(current) && (
                    <footer className="frame-note">
                        Blank on iPad or Safari? Use{' '}
                        <a
                            href={current.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => reloadOnReturn.current.add(current.id)}
                        >
                            Open tab
                        </a>{' '}
                        once to sign in. The site loads here after you return. Hidden sites may keep running.
                    </footer>
                )}
                <span className="sr-only" role="status" aria-live="polite">
                    {announcement}
                </span>
            </main>
        </div>
    );
}

function Login({ onLogin }: { onLogin: (username: string, password: string) => Promise<void> }) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    return (
        <form
            onSubmit={(event) => {
                event.preventDefault();
                setBusy(true);
                setError('');
                void onLogin(username, password)
                    .catch((cause) => {
                        setError(message(cause));
                        setPassword('');
                    })
                    .finally(() => setBusy(false));
            }}
        >
            <label>
                Username
                <input
                    autoComplete="username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    maxLength={100}
                    required
                />
            </label>
            <label>
                Password
                <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    maxLength={1024}
                    required
                />
            </label>
            {error && (
                <p role="alert" className="error">
                    {error}
                </p>
            )}
            <button className="primary login-submit" type="submit" disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in'}
            </button>
        </form>
    );
}

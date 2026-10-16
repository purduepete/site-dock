import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { api, ApiError, clampWidth, isExternal, moveFavorite, readPreference, savePreference, validateUrl, type Favorite, type Session, type Store, type Theme } from './model';
import { Icon } from './Icon';
import { useTheme } from './useTheme';
import { Dropdown } from './Dropdown';
import { DeleteFavoriteDialog } from './DeleteFavoriteDialog';
import { SiteIcon } from './SiteIcon';
import { CreateGroupDialog } from './CreateGroupDialog';

const localOrigins = ['localhost', '127.0.0.1', '[::1]'].flatMap(host => [8790, 5173].map(port => `http://${host}:${port}`));
const ownOrigins = [...localOrigins, location.origin, ...(import.meta.env.VITE_SITE_ORIGINS ?? '').split(',').map((value: string) => value.trim()).filter(Boolean)];
const message = (error: unknown) => error instanceof Error ? error.message : 'The request failed. Please try again.';
type Frame = { id: string; url: string; version: number };

function Conflict({ current, accept, discard }: { current: Store; accept: () => void; discard: () => void }) {
  return <section className="conflict" aria-label="Concurrent changes">
    <strong>Another browser changed your favorites.</strong>
    <p>Your pending list and form are still here. Latest revision {current.revision}:</p>
    <p>Groups: {current.groups?.join(', ') || 'None'}</p>
    <ol>{current.favorites.map(item => <li key={item.id}>{item.name} <small>{item.url} · {item.mode} · {item.groups?.join(', ') || 'No groups'}</small></li>)}</ol>
    {current.favorites.length === 0 && <p>The latest list is empty.</p>}
    <p>Compare the lists before continuing. Keeping your list will replace the latest list on your next save, including additions or deletions from another browser.</p>
    <div className="button-row"><button onClick={accept}>Keep pending list for review</button><button onClick={discard}>Use latest list</button></div>
  </section>;
}

function FavoriteForm({ favorite, groups, busy, blocked, allowedOrigins, onSave, onClose }: { favorite: Favorite; groups: string[]; busy: boolean; blocked: boolean; allowedOrigins: string[]; onSave: (favorite: Favorite) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState(favorite.name);
  const [url, setUrl] = useState(favorite.url);
  const [mode, setMode] = useState(favorite.mode);
  const [selectedGroups, setSelectedGroups] = useState(favorite.groups ?? []);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      if (!name.trim() || name.trim().length > 100) throw new Error('Use a name between 1 and 100 characters.');
      if (selectedGroups.some(group => !groups.includes(group))) throw new Error('A selected group is no longer available. Clear it before saving.');
      await onSave({ id: favorite.id, name: name.trim(), url: validateUrl(url, allowedOrigins), mode, ...(selectedGroups.length ? { groups: selectedGroups } : {}) });
    } catch (cause) { setError(message(cause)); }
  }
  return <section className="editor" aria-label={favorite.name ? 'Edit favorite' : 'Add favorite'}>
    <div className="section-heading"><h2>{favorite.name ? 'Edit favorite' : 'Add favorite'}</h2><button type="button" aria-label="Close editor" onClick={onClose} disabled={busy}><Icon name="close" /></button></div>
    <form onSubmit={event => void submit(event)}>
      <label>Name<input autoFocus maxLength={100} value={name} onChange={event => setName(event.target.value)} required /></label>
      <label>Website address<input type="url" maxLength={2048} placeholder="https://example.com/" value={url} onChange={event => setUrl(event.target.value)} required /></label>
      <fieldset className="favorite-groups" disabled={busy}><legend>Groups</legend>
        <p className="muted">Select every group this site belongs to. Sites with no groups appear in All sites.</p>
        {[...groups, ...selectedGroups.filter(group => !groups.includes(group))].map(group => <label key={group}>
          <input type="checkbox" checked={selectedGroups.includes(group)} onChange={event => setSelectedGroups(previous =>
            event.target.checked ? [...previous, group] : previous.filter(value => value !== group))} />
          <span>{group}{!groups.includes(group) && ' (no longer available)'}</span>
        </label>)}
        {!groups.length && !selectedGroups.length && <p className="muted">Create groups from the sidebar dropdown first.</p>}
      </fieldset>
      <div className="dropdown-field"><span>Open preference</span><Dropdown label="Open preference" value={mode} onChange={setMode} options={[{ value: 'embed', label: 'Inside SiteDock' }, { value: 'external', label: 'Separate tab' }]} /></div>
      <p className="muted">Some sites block embedding or require a separate tab for sign-in. HTTP sites always open separately when SiteDock uses HTTPS.</p>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="button-row"><button type="submit" className="primary" disabled={busy || blocked}>{busy ? 'Saving…' : 'Save favorite'}</button><button type="button" onClick={onClose} disabled={busy}>Close editor</button></div>
    </form>
  </section>;
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
  const visibleFavorites = useMemo(() => draft.filter(favorite => groupFilter === 'all' ||
    favorite.groups?.includes(groupFilter.slice(6))), [draft, groupFilter]);

  useEffect(() => {
    if (!session?.authenticated) return;
    function shortcut(event: KeyboardEvent) {
      if (!event.ctrlKey || event.altKey || event.shiftKey || event.metaKey || event.repeat || event.isComposing || event.defaultPrevented || !/^[1-9]$/.test(event.key)) return;
      const target = event.target;
      if (editor || deleteTarget || creatingGroup || (target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="combobox"], [role="listbox"], dialog'))) return;
      const favorite = visibleFavorites[Number(event.key) - 1];
      const control = favorite && favoriteControls.current.get(favorite.id);
      if (!control) return;
      event.preventDefault();
      control.click();
    }
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [session?.authenticated, visibleFavorites, editor, deleteTarget, creatingGroup]);

  function clearSession(reason = '') {
    generation.current++;
    auth.current = false;
    saving.current = false;
    setSession({ authenticated: false });
    setStore(null); setDraft([]); setGroups([]); setCreatingGroup(false); setFrames([]); setEditor(null); setDeleteTarget(null); setConflict(null);
    setPending(false); setBusy(false); setSidebar(false); setResizing(false); setError(reason);
  }

  async function checkSession() {
    const request = ++requestNumber.current;
    const epoch = generation.current;
    try {
      const result = await api<Session>('session');
      if (request !== requestNumber.current || epoch !== generation.current) return;
      if (!result.authenticated) { clearSession(auth.current ? 'Your session ended. Sign in again.' : ''); return; }
      auth.current = true;
      setSession(result);
    } catch (cause) {
      if (request === requestNumber.current && epoch === generation.current) {
        if (cause instanceof ApiError && cause.status === 401) clearSession('Your session ended. Sign in again.');
        else setError(`Could not check your session. ${message(cause)}`);
      }
    }
  }

  useEffect(() => {
    void checkSession();
    const focus = () => { if (document.visibilityState !== 'hidden') void checkSession(); };
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    return () => { window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); requestNumber.current++; };
    // Session checks use refs to avoid replacing a pending edit on window focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!session?.authenticated) return;
    let active = true;
    const epoch = generation.current;
    void api<Store>('favorites').then(result => {
      if (active && epoch === generation.current) { setStore(result); setDraft(result.favorites); setGroups(result.groups ?? []); setError(''); }
    }).catch(cause => {
      if (!active || epoch !== generation.current) return;
      if (cause instanceof ApiError && cause.status === 401) clearSession('Your session ended. Sign in again.');
      else setError(`Could not load favorites. ${message(cause)}`);
    });
    return () => { active = false; };
    // Only authentication transitions load the shared list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.authenticated, loadAttempt]);

  useEffect(() => {
    if (!session?.authenticated || !store) return;
    const next = visibleFavorites.some(item => item.id === selected) ? selected : visibleFavorites[0]?.id ?? '';
    if (next !== selected) setSelected(next);
    savePreference('selected', next);
    setFrames(previous => {
      const kept = previous.filter(frame => draft.some(item => item.id === frame.id && item.url === frame.url && !isExternal(item)));
      const current = draft.find(item => item.id === next);
      if (current && !isExternal(current) && !kept.some(frame => frame.id === current.id)) return [...kept, { id: current.id, url: current.url, version: 0 }];
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

  useEffect(() => { savePreference('width', String(width)); }, [width]);
  useEffect(() => {
    if (!resizing) return;
    const end = () => setResizing(false);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => { window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); };
  }, [resizing]);

  async function save(next: Favorite[], operation?: 'reorder', nextGroups = groups): Promise<boolean> {
    if (!store || conflict || saving.current || !auth.current) return false;
    saving.current = true;
    setDraft(next); setGroups(nextGroups); setPending(true); setBusy(true); setError('');
    const epoch = generation.current;
    try {
      const result = await api<Store>('favorites', { baseRevision: store.revision, favorites: next, groups: nextGroups, ...(operation ? { operation } : {}) });
      if (epoch !== generation.current) return false;
      setStore(result); setDraft(result.favorites); setGroups(result.groups ?? []); setPending(false); setAnnouncement('Favorites saved.');
      return true;
    } catch (cause) {
      if (epoch !== generation.current) return false;
      if (cause instanceof ApiError && cause.status === 401) clearSession('Your session ended. Sign in again.');
      else if (cause instanceof ApiError && cause.status === 409 && cause.store) { setConflict(cause.store); setError('Review the concurrent changes before saving again.'); }
      else setError(`Changes are still pending. ${message(cause)}`);
      return false;
    } finally {
      if (epoch === generation.current) { setBusy(false); saving.current = false; }
    }
  }

  function choose(id: string) { setSelected(id); setSidebar(false); }
  function filterGroup(value: string) {
    setGroupFilter(value);
    savePreference('group', value);
  }
  function reorder(id: string, target: number) {
    const reordered = moveFavorite(visibleFavorites, id, target);
    if (reordered !== visibleFavorites) {
      const visibleIds = new Set(visibleFavorites.map(favorite => favorite.id));
      let position = 0;
      const next = draft.map(favorite => visibleIds.has(favorite.id) ? reordered[position++] : favorite);
      setAnnouncement(`${draft.find(item => item.id === id)?.name} moved to position ${target + 1}.`);
      void save(next, pending ? undefined : 'reorder');
    }
  }
  async function logout() {
    requestNumber.current++;
    clearSession();
    try { await api('logout', {}); }
    catch (cause) { setError(`The dashboard is cleared, but server sign-out could not be confirmed. Retry sign-out before leaving this browser. ${message(cause)}`); }
  }
  const current = draft.find(item => item.id === selected);
  const conflictPanel = conflict && <Conflict current={conflict} accept={() => {
    setStore(conflict); setConflict(null); setError('Pending list retained. Review it, then save to replace the latest server list.');
  }} discard={() => {
    setStore(conflict); setDraft(conflict.favorites); setGroups(conflict.groups ?? []); setPending(false); setConflict(null); setError('Latest list loaded. Unsaved form input is still available.');
  }} />;
  const themeControl = <div className="theme-control"><span>Theme</span><Dropdown<Theme> label="Theme" value={theme} onChange={setTheme} options={[{ value: 'system', label: 'System' }, { value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} /></div>;

  if (!session?.authenticated) return <div className="login-page">
    <header className="login-header"><span className="wordmark"><span className="brand-mark">S</span>SiteDock</span>{themeControl}</header>
    <main className="login-card"><p className="eyebrow">YOUR SITES, ONE PLACE</p><h1>Your everyday dock.</h1><p className="muted">Sign in to your shared favorites. Your sites keep their own accounts and sign-ins.</p>
      {error && <div role="alert" className="error">{error}</div>}
      {session === null ? <><p role="status">Checking your session…</p>{error && <button onClick={() => void checkSession()}>Retry connection</button>}</> :
        <Login onLogin={async (username, password) => {
          setError('');
          await api('login', { username, password });
          await checkSession();
        }} />}
      {error.includes('server sign-out') && <button onClick={() => void logout()}>Retry sign-out</button>}
      <p className="login-note">Private access · Favorites shared across devices</p>
    </main><footer className="login-footer">Signing out of SiteDock leaves source-site sign-ins unchanged. Sites are not cached for offline use.</footer>
  </div>;

  return <div className={`app ${resizing ? 'interacting' : ''} ${minimized ? 'sidebar-minimized' : ''}`} style={{ '--sidebar-width': `${width}px` } as CSSProperties}>
    {creatingGroup && <CreateGroupDialog groups={store?.groups ?? []} busy={busy} onCancel={() => setCreatingGroup(false)} onSave={async name => {
      if (await save(draft, undefined, groups.includes(name) ? groups : [...groups, name])) {
        setCreatingGroup(false);
        filterGroup(`group:${name}`);
        setAnnouncement(`Group ${name} created.`);
        return true;
      }
      return false;
    }} />}
    {deleteTarget && <DeleteFavoriteDialog favorite={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={() => {
      setDeleteTarget(null);
      void save(draft.filter(item => item.id !== deleteTarget.id));
    }} />}
    {sidebar && <button className="scrim" aria-label="Close favorites" onClick={() => setSidebar(false)} />}
    <aside id="favorites-sidebar" className={`sidebar ${sidebar ? 'is-open' : ''}`} aria-label="Favorites">
      <div className="sidebar-brand"><span className="wordmark"><span className="brand-mark mobile-only">S</span><button type="button" className="brand-mark brand-toggle desktop-only" aria-label={minimized ? 'Expand favorites' : 'Minimize favorites'} title={minimized ? 'Expand sidebar' : 'Minimize sidebar'} aria-controls="favorites-sidebar" aria-expanded={!minimized} onClick={() => {
        const next = !minimized;
        setMinimized(next); setResizing(false); savePreference('sidebar-minimized', String(next));
      }}>S</button>SiteDock</span><button className="mobile-only" aria-label="Close favorites" onClick={() => setSidebar(false)}><Icon name="close" /></button></div>
      <div className="section-heading list-heading"><span className="eyebrow">FAVORITES <span className="count">{visibleFavorites.length}</span></span><button aria-label="Add favorite" disabled={!store || busy} onClick={() => { setEditor({ id: crypto.randomUUID(), name: '', url: '', mode: 'embed', ...(groupFilter.startsWith('group:') ? { groups: [groupFilter.slice(6)] } : {}) }); setSidebar(false); }}><Icon name="plus" /></button></div>
      <div className="group-filter"><Dropdown label="Group" value={groupFilter} options={[
        { value: 'all', label: 'All sites' },
        ...groups.map(name => ({ value: `group:${name}`, label: name })),
        { value: 'create', label: 'Create group...' },
      ]} onChange={value => {
        if (value !== 'create') { filterGroup(value); return; }
        if (!store || busy || conflict || pending || editor) { setError('Finish or discard pending edits before creating a group.'); return; }
        setCreatingGroup(true);
      }} /></div>
      <nav className="favorites-list" aria-label="Favorite websites">
        {visibleFavorites.map((favorite, index) => <div key={favorite.id} className={`favorite ${selected === favorite.id ? 'selected' : ''}`}>
          <div className="favorite-main">
            <SiteIcon key={favorite.url} url={favorite.url} name={favorite.name} />
            {isExternal(favorite) ? <a ref={element => { if (element) favoriteControls.current.set(favorite.id, element); else favoriteControls.current.delete(favorite.id); }} className="favorite-select" aria-label={`Open ${favorite.name} in a separate tab`} aria-keyshortcuts={index < 9 ? `Control+${index + 1}` : undefined} title={index < 9 ? `${favorite.name} (Ctrl+${index + 1})` : favorite.name} href={favorite.url} target="_blank" rel="noopener noreferrer" aria-current={selected === favorite.id ? 'page' : undefined} onClick={() => choose(favorite.id)}><span>{favorite.name}</span><small>Separate tab{index < 9 && <kbd>Ctrl+{index + 1}</kbd>}</small></a> :
              <button ref={element => { if (element) favoriteControls.current.set(favorite.id, element); else favoriteControls.current.delete(favorite.id); }} className="favorite-select" aria-label={favorite.name} aria-keyshortcuts={index < 9 ? `Control+${index + 1}` : undefined} title={index < 9 ? `${favorite.name} (Ctrl+${index + 1})` : favorite.name} aria-current={selected === favorite.id ? 'page' : undefined} onClick={() => choose(favorite.id)}><span>{favorite.name}</span><small>{new URL(favorite.url).hostname}{index < 9 && <kbd>Ctrl+{index + 1}</kbd>}</small></button>}
            {isExternal(favorite) && <Icon name="external" />}
          </div>
          <div className="favorite-actions">
            <button aria-label={`Move ${favorite.name} up`} title="Move up" disabled={index === 0 || busy || !!conflict} onClick={() => reorder(favorite.id, index - 1)}><Icon name="up" /></button>
            <button aria-label={`Move ${favorite.name} down`} title="Move down" disabled={index === visibleFavorites.length - 1 || busy || !!conflict} onClick={() => reorder(favorite.id, index + 1)}><Icon name="down" /></button>
            <button aria-label={`Edit ${favorite.name}`} title="Edit favorite" disabled={busy} onClick={() => { setEditor(favorite); setSidebar(false); }}><Icon name="edit" /></button>
            <button aria-label={`Delete ${favorite.name}`} title="Delete favorite" disabled={busy || !!conflict} onClick={() => setDeleteTarget(favorite)}><Icon name="trash" /></button>
          </div>
        </div>)}
        {store && !visibleFavorites.length && <p className="sidebar-empty">{groupFilter === 'all' ? 'Add your first favorite to get started.' : 'No sites in this group. Add a favorite or edit a site in All sites to assign it here.'}</p>}
      </nav>
      <footer className="sidebar-footer">{themeControl}<div className="account"><span><small>Signed in as</small>{session.username ?? 'Owner'}</span><button aria-label="Sign out" title="Sign out of SiteDock" onClick={() => void logout()}><Icon name="logout" /></button></div></footer>
    </aside>
    <div role="separator" aria-label="Sidebar width" aria-orientation="vertical" aria-valuemin={220} aria-valuemax={480} aria-valuenow={width} tabIndex={0} className="resize-handle"
      onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); setWidth(value => event.key === 'Home' ? 220 : event.key === 'End' ? 480 : clampWidth(value + (event.key === 'ArrowRight' ? 10 : -10))); } }}
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); resizeOrigin.current = { x: event.clientX, width }; event.currentTarget.setPointerCapture(event.pointerId); setResizing(true); }}
      onPointerMove={event => { if (resizing) setWidth(clampWidth(resizeOrigin.current.width + event.clientX - resizeOrigin.current.x)); }}
      onLostPointerCapture={() => setResizing(false)} onPointerUp={() => setResizing(false)} onPointerCancel={() => setResizing(false)} />
    <main className="workspace">
      <header className="workspace-header"><button className="mobile-only" aria-label="Show favorites" aria-controls="favorites-sidebar" aria-expanded={sidebar} onClick={() => setSidebar(true)}><Icon name="menu" /></button>
        <div className="site-title"><h1>{current?.name ?? 'Your workspace'}</h1></div>
        <div className="toolbar">{current && <><button disabled={isExternal(current)} aria-label="Reload selected site" title="Reload from the saved address" onClick={() => setFrames(previous => previous.map(frame => frame.id === selected ? { ...frame, version: frame.version + 1 } : frame))}><Icon name="reload" /><span className="toolbar-label">Reload</span></button><a className="button" href={current.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${current.name} in a new tab`}><Icon name="external" /><span className="toolbar-label">Open tab</span></a></>}</div>
      </header>
      <div className="notices">
        {error && <p role="alert" className="error">{error}</p>}
        {conflictPanel}
        {pending && !conflict && <div className="pending"><span>You have pending changes.</span><button disabled={busy || !!editor} onClick={() => void save(draft)}>{busy ? 'Saving…' : 'Save pending list'}</button><button disabled={busy} onClick={() => { if (store) { setDraft(store.favorites); setGroups(store.groups ?? []); setPending(false); setError(''); } }}>Discard pending list</button></div>}
        {!store && <p role="status">Loading favorites… <button onClick={() => setLoadAttempt(value => value + 1)}>Retry</button></p>}
        {editor && <FavoriteForm key={editor.id} favorite={editor} groups={groups} busy={busy} blocked={!!conflict} allowedOrigins={[...ownOrigins, ...(session.allowedOrigins ?? [])]} onClose={() => setEditor(null)} onSave={async favorite => {
          const next = draft.some(item => item.id === favorite.id) ? draft.map(item => item.id === favorite.id ? favorite : item) : [...draft, favorite];
          if (await save(next)) {
            if (groupFilter !== 'all' && !favorite.groups?.includes(groupFilter.slice(6))) {
              filterGroup(favorite.groups?.length ? `group:${favorite.groups[0]}` : 'all');
            }
            setEditor(null); choose(favorite.id);
          }
        }} />}
      </div>
      <div className="site-area">
        {frames.map(frame => {
          const key = `${frame.id}:${frame.url}:${frame.version}`;
          const active = selected === frame.id;
          return <iframe key={key} title={draft.find(item => item.id === frame.id)?.name ?? 'Favorite website'} src={frame.url}
            className={`site-frame${active ? ' active' : ''}${loadedFrames.has(key) ? ' loaded' : ''}`} aria-hidden={active ? undefined : true} inert={!active}
            onLoad={() => setLoadedFrames(previous => previous.has(key) ? previous : new Set(previous).add(key))}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" />;
        })}
        {current && isExternal(current) && <section className="empty-state"><div className="state-icon"><Icon name="external" /></div><p className="eyebrow">SEPARATE TAB</p><h2>{current.name}</h2><p>{current.mode === 'embed' ? 'This site uses HTTP. Your HTTPS connection prevents it from being embedded here.' : 'This favorite is set to open in a separate browser tab.'}</p><a className="button primary" href={current.url} target="_blank" rel="noopener noreferrer"><Icon name="external" />Open {current.name}</a><p className="muted">Your browser may require a separate sign-in.</p></section>}
        {!current && store && <section className="empty-state"><div className="state-icon"><Icon name="plus" /></div><p className="eyebrow">MAKE ROOM FOR YOUR ROUTINE</p><h2>Your sites start here.</h2><p>Add a favorite, then keep your everyday sites close at hand.</p><button className="primary" onClick={() => setEditor({ id: crypto.randomUUID(), name: '', url: '', mode: 'embed' })}><Icon name="plus" />Add favorite</button></section>}
      </div>
      {current && !isExternal(current) && <footer className="frame-note">Site blank or sign-in blocked? Use <a href={current.url} target="_blank" rel="noopener noreferrer">Open tab</a>. Reload returns to the saved address. Hidden sites may keep running.</footer>}
      <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
    </main>
  </div>;
}

function Login({ onLogin }: { onLogin: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <form onSubmit={event => {
    event.preventDefault(); setBusy(true); setError('');
    void onLogin(username, password).catch(cause => { setError(message(cause)); setPassword(''); }).finally(() => setBusy(false));
  }}><label>Username<input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} maxLength={100} required /></label>
    <label>Password<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} maxLength={1024} required /></label>
    {error && <p role="alert" className="error">{error}</p>}
    <button className="primary login-submit" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
  </form>;
}

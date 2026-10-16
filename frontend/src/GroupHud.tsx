import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

export type HudOption = { value: string; label: string; count: number };

export function GroupHud({ options, current, returnTo, onApply, onClose }: {
  options: HudOption[];
  current: string;
  returnTo?: HTMLElement | null;
  onApply: (value: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const returnFocus = useRef(returnTo ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  const title = useId();
  const list = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(() => Math.max(0, options.findIndex(option => option.value === current)));
  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    return text ? options.filter(option => option.label.toLowerCase().includes(text)) : options;
  }, [options, query]);
  const index = filtered.length ? Math.min(active, filtered.length - 1) : -1;

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    input.current?.focus();
    return () => {
      element.close();
      if (returnFocus.current?.isConnected) returnFocus.current.focus();
    };
  }, []);
  useEffect(() => { document.getElementById(`${list}-${index}`)?.scrollIntoView?.({ block: 'nearest' }); }, [list, index]);

  function move(step: number) {
    if (filtered.length) setActive((index + step + filtered.length) % filtered.length);
  }
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.code === 'KeyG' && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault();
      if (!event.repeat) move(1);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (index >= 0) onApply(filtered[index].value);
    }
  }

  return createPortal(<dialog ref={dialog} className="group-hud" aria-labelledby={title}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="group-hud-body">
      <h2 id={title}>Switch group</h2>
      <input ref={input} role="combobox" aria-label="Filter groups" aria-expanded="true" aria-autocomplete="list" aria-controls={list}
        aria-activedescendant={index >= 0 ? `${list}-${index}` : undefined} placeholder="Type to filter" autoComplete="off" spellCheck={false}
        value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} onKeyDown={keyDown} />
      <ul id={list} role="listbox" aria-label="Groups">
        {filtered.map((option, position) => <li key={option.value} id={`${list}-${position}`} role="option" aria-selected={position === index}
          className={`group-hud-option${position === index ? ' is-active' : ''}${option.value === current ? ' is-current' : ''}`}
          onMouseDown={event => event.preventDefault()} onClick={() => onApply(option.value)}>
          <span>{option.label}</span><span className="group-hud-count" aria-label={`${option.count} ${option.count === 1 ? 'site' : 'sites'}`}>{option.count}</span>
        </li>)}
      </ul>
      {!filtered.length && <p className="muted group-hud-empty" role="status">No matching groups</p>}
      <p className="muted group-hud-hint"><kbd>Alt+G</kbd> next · <kbd>Enter</kbd> switch · <kbd>Esc</kbd> close</p>
    </div>
  </dialog>, document.body);
}

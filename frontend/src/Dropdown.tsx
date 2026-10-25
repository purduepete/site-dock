import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { Hint } from './InfoBox';

type Option<T extends string> = { value: T; label: string };

export function Dropdown<T extends string>({
    label,
    value,
    options,
    onChange,
    hint = false,
}: {
    label: string;
    value: T;
    options: readonly Option<T>[];
    onChange: (value: T) => void;
    hint?: boolean;
}) {
    const id = useId();
    const trigger = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(0);
    const [position, setPosition] = useState({ top: 0, left: 0, width: 190 });
    const selected = Math.max(
        0,
        options.findIndex((option) => option.value === value)
    );

    function show(index = selected) {
        setActive(index);
        setOpen(true);
    }

    function choose(index: number) {
        onChange(options[index].value);
        setOpen(false);
        trigger.current?.focus();
    }

    useLayoutEffect(() => {
        if (!open) return;
        function place() {
            const anchor = trigger.current?.getBoundingClientRect();
            if (!anchor) return;
            const width = Math.min(Math.max(190, anchor.width), window.innerWidth - 16);
            const height = Math.min(panel.current?.scrollHeight ?? 240, 240, window.innerHeight - 16);
            const below = window.innerHeight - anchor.bottom - 8;
            const top =
                below >= height || below >= anchor.top - 8
                    ? Math.min(anchor.bottom + 4, window.innerHeight - height - 8)
                    : Math.max(8, anchor.top - height - 4);
            setPosition({ top, left: Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)), width });
        }
        place();
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        return () => {
            window.removeEventListener('resize', place);
            window.removeEventListener('scroll', place, true);
        };
    }, [open]);

    useEffect(() => {
        if (!open) return;
        function outside(event: PointerEvent | FocusEvent) {
            if (
                event.target instanceof Node &&
                !trigger.current?.contains(event.target) &&
                !panel.current?.contains(event.target)
            )
                setOpen(false);
        }
        document.addEventListener('pointerdown', outside);
        document.addEventListener('focusin', outside);
        return () => {
            document.removeEventListener('pointerdown', outside);
            document.removeEventListener('focusin', outside);
        };
    }, [open]);

    useEffect(() => {
        if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView?.({ block: 'nearest' });
    }, [open, active, id]);

    function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
        if (event.key === 'Tab' || event.key === 'Escape') {
            setOpen(false);
            if (event.key === 'Escape' && open) event.preventDefault();
            return;
        }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const index =
                event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? options.length - 1
                      : ((open ? active : selected) + (event.key === 'ArrowDown' ? 1 : -1) + options.length) %
                        options.length;
            show(index);
        } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (open) choose(active);
            else show();
        } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            const index = options.findIndex((option) => option.label.toLowerCase().startsWith(event.key.toLowerCase()));
            if (index >= 0) {
                event.preventDefault();
                show(index);
            }
        }
    }

    const control = (
        <button
            ref={trigger}
            type="button"
            className="dropdown-trigger"
            role="combobox"
            aria-label={label}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? id : undefined}
            aria-activedescendant={open ? `${id}-${active}` : undefined}
            onKeyDown={keyDown}
            onClick={() => (open ? setOpen(false) : show())}
        >
            <span>{options[selected]?.label}</span>
            <Icon name="down" />
        </button>
    );
    return (
        <div className="dropdown">
            {hint ? <Hint text={options[selected]?.label ?? label}>{control}</Hint> : control}
            {open &&
                createPortal(
                    <div
                        ref={panel}
                        id={id}
                        className="dropdown-panel"
                        role="listbox"
                        aria-label={label}
                        style={{ top: position.top, left: position.left, width: position.width }}
                    >
                        {options.map((option, index) => (
                            <button
                                key={option.value}
                                id={`${id}-${index}`}
                                type="button"
                                role="option"
                                aria-selected={value === option.value}
                                tabIndex={-1}
                                className={`dropdown-option ${index === active ? 'is-active' : ''}`}
                                onPointerDown={(event) => event.preventDefault()}
                                onPointerMove={() => setActive(index)}
                                onClick={() => choose(index)}
                            >
                                <span className="dropdown-tick">
                                    {value === option.value && (
                                        <svg
                                            viewBox="0 0 16 16"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            aria-hidden="true"
                                        >
                                            <path d="m3 8 3 3 7-7" />
                                        </svg>
                                    )}
                                </span>
                                <span>{option.label}</span>
                            </button>
                        ))}
                    </div>,
                    trigger.current?.closest('dialog') ?? document.body
                )}
        </div>
    );
}

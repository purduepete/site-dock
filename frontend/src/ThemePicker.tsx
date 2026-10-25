import {
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
    type KeyboardEvent,
    type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { Theme } from './model';

const options: { value: Theme; label: string; icon: ReactNode }[] = [
    {
        value: 'light',
        label: 'Light',
        icon: (
            <>
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
            </>
        ),
    },
    { value: 'midnight', label: 'Midnight', icon: <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" /> },
    {
        value: 'system',
        label: 'System',
        icon: (
            <>
                <rect x="3" y="3" width="18" height="13" rx="1" />
                <path d="M8 21h8m-4-5v5" />
            </>
        ),
    },
];

function Svg({ children }: { children: ReactNode }) {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            {children}
        </svg>
    );
}

export function ThemePicker({ theme, onChange }: { theme: Theme; onChange: (theme: Theme) => void }) {
    const id = useId();
    const trigger = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState({ top: 0, left: 0, width: 320 });
    const index = Math.max(
        0,
        options.findIndex((option) => option.value === theme)
    );
    const current = options[index];

    function close(restoreFocus = false) {
        setOpen(false);
        if (restoreFocus) trigger.current?.focus();
    }

    useLayoutEffect(() => {
        if (!open) return;
        function place() {
            const anchor = trigger.current?.getBoundingClientRect();
            if (!anchor) return;
            const width = Math.min(320, window.innerWidth - 16);
            const height = panel.current?.offsetHeight ?? 90;
            const below = window.innerHeight - anchor.bottom - 8;
            const top = below >= height + 8 ? anchor.bottom + 8 : Math.max(8, anchor.top - height - 8);
            const left = Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8));
            setPosition({ top, left, width });
        }
        place();
        panel.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
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
        const blur = () => setOpen(false);
        document.addEventListener('pointerdown', outside);
        document.addEventListener('focusin', outside);
        window.addEventListener('blur', blur);
        return () => {
            document.removeEventListener('pointerdown', outside);
            document.removeEventListener('focusin', outside);
            window.removeEventListener('blur', blur);
        };
    }, [open]);

    function pickerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        if (event.key === 'Escape') {
            event.preventDefault();
            close(true);
            return;
        }
        if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next =
            event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? options.length - 1
                  : (index + (['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : options.length - 1)) %
                    options.length;
        onChange(options[next].value);
        panel.current?.querySelectorAll<HTMLButtonElement>('[data-value]')[next]?.focus();
    }

    return (
        <div className="theme-picker">
            <button
                ref={trigger}
                type="button"
                className="icon-button theme-toggle"
                aria-label={`Theme: ${current.label}`}
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls={open ? id : undefined}
                onPointerDown={(event) => {
                    // Safari can blur the focused option before clicking this non-focused button.
                    if (event.button === 0) event.preventDefault();
                }}
                onClick={() => (open ? close() : setOpen(true))}
                onKeyDown={(event) => {
                    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
                        event.preventDefault();
                        setOpen(true);
                    } else if (event.key === 'Escape' && open) {
                        event.preventDefault();
                        close();
                    }
                }}
            >
                <Svg>
                    <path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 0-4 1.5 1.5 0 0 1 0-3h2a6 6 0 0 0 6-6c0-3-4-5-9-5Z" />
                    <circle cx="7.5" cy="10" r=".5" />
                    <circle cx="10" cy="6.5" r=".5" />
                    <circle cx="15" cy="7" r=".5" />
                </Svg>
            </button>
            {open &&
                createPortal(
                    <div
                        ref={panel}
                        id={id}
                        className="theme-popover"
                        role="dialog"
                        aria-label="Appearance settings"
                        style={{ top: position.top, left: position.left, width: position.width }}
                        onKeyDown={pickerKeyDown}
                    >
                        <span className="theme-popover-label">Theme</span>
                        <div
                            className="theme-pill"
                            role="group"
                            aria-label="Theme"
                            style={{ '--theme-index': index } as CSSProperties}
                        >
                            <span className="theme-selection" aria-hidden="true" />
                            {options.map((option) => (
                                <button
                                    key={option.value}
                                    type="button"
                                    data-value={option.value}
                                    aria-label={option.label}
                                    aria-pressed={option.value === theme}
                                    tabIndex={option.value === theme ? 0 : -1}
                                    onClick={() => onChange(option.value)}
                                >
                                    <Svg>{option.icon}</Svg>
                                    <span>{option.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>,
                    trigger.current?.closest('dialog') ?? document.body
                )}
        </div>
    );
}

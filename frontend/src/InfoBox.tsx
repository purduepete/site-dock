import {
    cloneElement,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type HTMLAttributes,
    type ReactElement,
    type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';
import { isAppleTouchDevice } from './device';

export function InfoBox({
    heading,
    children,
    control,
}: {
    heading?: string;
    children: ReactNode;
    control?: ReactElement<HTMLAttributes<HTMLElement>>;
}) {
    const id = useId();
    const appleTouchDevice = isAppleTouchDevice();
    const trigger = useRef<HTMLElement | null>(null);
    const box = useRef<HTMLDivElement>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState({ left: 8, top: 8 });
    const cancelClose = () => clearTimeout(timer.current);
    const contains = (node: EventTarget | null) =>
        node instanceof Node && (trigger.current?.contains(node) || box.current?.contains(node));
    const closeSoon = () => {
        cancelClose();
        timer.current = setTimeout(() => {
            if (!contains(document.activeElement)) setOpen(false);
        }, 120);
    };
    useEffect(() => () => clearTimeout(timer.current), []);
    useEffect(() => {
        if (!open) return;
        const outside = (event: PointerEvent | FocusEvent) => {
            if (!contains(event.target)) setOpen(false);
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
            }
        };
        document.addEventListener('pointerdown', outside);
        document.addEventListener('focusin', outside);
        document.addEventListener('keydown', escape, true);
        return () => {
            document.removeEventListener('pointerdown', outside);
            document.removeEventListener('focusin', outside);
            document.removeEventListener('keydown', escape, true);
        };
    }, [open]);
    useLayoutEffect(() => {
        if (!open) return;
        const place = () => {
            const anchor = trigger.current?.getBoundingClientRect();
            const popup = box.current?.getBoundingClientRect();
            if (!anchor || !popup) return;
            setPosition({
                left: Math.max(8, Math.min(anchor.left, window.innerWidth - popup.width - 8)),
                top:
                    anchor.bottom + popup.height + 4 <= window.innerHeight - 8
                        ? anchor.bottom + 4
                        : Math.max(8, anchor.top - popup.height - 4),
            });
        };
        place();
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
        if (box.current) observer?.observe(box.current);
        return () => {
            window.removeEventListener('resize', place);
            window.removeEventListener('scroll', place, true);
            observer?.disconnect();
        };
    }, [open]);
    const props: HTMLAttributes<HTMLElement> = {
        'aria-describedby': [control?.props['aria-describedby'], id].filter(Boolean).join(' '),
        ...(control?.props['aria-expanded'] === undefined ? { 'aria-expanded': open } : {}),
        onPointerEnter: (event) => {
            control?.props.onPointerEnter?.(event);
            if (appleTouchDevice || event.pointerType === 'touch') return;
            trigger.current = event.currentTarget;
            cancelClose();
            setOpen(true);
        },
        onPointerLeave: (event) => {
            control?.props.onPointerLeave?.(event);
            closeSoon();
        },
        onFocus: (event) => {
            control?.props.onFocus?.(event);
            if (appleTouchDevice) return;
            trigger.current = event.currentTarget;
            cancelClose();
            setOpen(true);
        },
        onBlur: (event) => {
            control?.props.onBlur?.(event);
            if (!contains(event.relatedTarget)) setOpen(false);
        },
        onClick: (event) => {
            control?.props.onClick?.(event);
            setOpen(false);
        },
    };
    return (
        <>
            {control ? (
                cloneElement(control, props)
            ) : (
                <button
                    {...props}
                    type="button"
                    className="info-box-trigger"
                    aria-label={`${heading ?? 'More'} information`}
                    onClick={(event) => {
                        trigger.current = event.currentTarget;
                        cancelClose();
                        setOpen(true);
                    }}
                >
                    <Info size={14} aria-hidden="true" />
                </button>
            )}
            {createPortal(
                <div
                    ref={box}
                    id={id}
                    role={open ? 'tooltip' : undefined}
                    className={`info-box${open ? ' is-open' : ''}`}
                    style={open ? position : undefined}
                    onPointerEnter={cancelClose}
                    onPointerLeave={closeSoon}
                >
                    {heading && <strong>{heading}</strong>}
                    {children}
                </div>,
                trigger.current?.closest('dialog') ?? document.body
            )}
        </>
    );
}

export function Hint({ text, children }: { text: string; children: ReactElement<HTMLAttributes<HTMLElement>> }) {
    return <InfoBox control={children}>{text}</InfoBox>;
}

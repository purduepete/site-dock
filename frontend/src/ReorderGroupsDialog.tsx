import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

export function ReorderGroupsDialog({
    groups,
    busy,
    blocked,
    onSave,
    onCancel,
}: {
    groups: string[];
    busy: boolean;
    blocked: boolean;
    onSave: (groups: string[]) => Promise<boolean>;
    onCancel: () => void;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    const returnFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const title = useId();
    const [order, setOrder] = useState(groups);
    const initialOrder = useRef(groups);
    const [error, setError] = useState('');
    const [announcement, setAnnouncement] = useState('');
    const changed = order.some((name, index) => name !== initialOrder.current[index]);

    useEffect(() => {
        const target = returnFocus.current;
        const element = dialog.current!;
        element.showModal();
        return () => {
            element.close();
            if (target?.isConnected) target.focus();
        };
    }, []);

    function move(index: number, step: number) {
        const next = [...order];
        [next[index], next[index + step]] = [next[index + step], next[index]];
        setOrder(next);
        setAnnouncement(`${order[index]} moved to position ${index + step + 1}.`);
    }

    return createPortal(
        <dialog
            ref={dialog}
            className="confirmation-modal"
            aria-labelledby={title}
            onCancel={(event) => {
                event.preventDefault();
                if (!busy) onCancel();
            }}
        >
            <h2 id={title}>Reorder groups</h2>
            <p className="muted">Move groups up or down. All sites always stays first.</p>
            <ol className="group-order" aria-label="Group order">
                {order.map((name, index) => (
                    <li key={name}>
                        <span className="group-order-name">{name}</span>
                        <button
                            type="button"
                            aria-label={`Move ${name} up`}
                            disabled={busy || blocked || index === 0}
                            onClick={() => move(index, -1)}
                        >
                            <Icon name="up" />
                        </button>
                        <button
                            type="button"
                            aria-label={`Move ${name} down`}
                            disabled={busy || blocked || index === order.length - 1}
                            onClick={() => move(index, 1)}
                        >
                            <Icon name="down" />
                        </button>
                    </li>
                ))}
            </ol>
            {order.length < 2 && <p className="muted">Create at least 2 groups to change their order.</p>}
            <span className="sr-only" role="status">
                {announcement}
            </span>
            {error && (
                <p className="error" role="alert">
                    {error}
                </p>
            )}
            <div className="button-row">
                <button
                    type="button"
                    className="primary"
                    disabled={busy || blocked || !changed}
                    onClick={async () => {
                        setError('');
                        if (!(await onSave(order)))
                            setError(
                                'Group order could not be saved. Retry, or cancel to review the pending changes on the dashboard.'
                            );
                    }}
                >
                    {busy ? 'Saving...' : 'Save order'}
                </button>
                <button type="button" disabled={busy} onClick={onCancel}>
                    Cancel
                </button>
            </div>
        </dialog>,
        document.body
    );
}

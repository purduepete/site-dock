import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';

export function CreateGroupDialog({
    groups,
    busy,
    onSave,
    onCancel,
}: {
    groups: string[];
    busy: boolean;
    onSave: (name: string) => Promise<boolean>;
    onCancel: () => void;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    const returnFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const title = useId();
    const [name, setName] = useState('');
    const [error, setError] = useState('');
    useEffect(() => {
        const target = returnFocus.current;
        const element = dialog.current!;
        element.showModal();
        return () => {
            element.close();
            if (target?.isConnected) target.focus();
        };
    }, []);

    async function submit(event: FormEvent) {
        event.preventDefault();
        const value = name.trim();
        if (!value || value.length > 50) {
            setError('Use a group name between 1 and 50 characters.');
            return;
        }
        if (groups.some((group) => group.toLowerCase() === value.toLowerCase())) {
            setError('A group with this name already exists.');
            return;
        }
        if (groups.length >= 50) {
            setError('You can create up to 50 groups.');
            return;
        }
        setError('');
        if (!(await onSave(value)))
            setError('The group could not be saved. Retry, or cancel to review the pending changes on the dashboard.');
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
            <h2 id={title}>Create group</h2>
            <form onSubmit={(event) => void submit(event)}>
                <label>
                    Group name
                    <input
                        autoFocus
                        maxLength={50}
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        required
                        disabled={busy}
                    />
                </label>
                {error && (
                    <p role="alert" className="error">
                        {error}
                    </p>
                )}
                <p className="muted">Assign sites to this group when adding or editing a favorite.</p>
                <div className="button-row">
                    <button type="submit" className="primary" disabled={busy}>
                        {busy ? 'Saving...' : 'Create group'}
                    </button>
                    <button type="button" disabled={busy} onClick={onCancel}>
                        Cancel
                    </button>
                </div>
            </form>
        </dialog>,
        document.body
    );
}

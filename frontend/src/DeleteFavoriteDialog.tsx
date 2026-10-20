import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Favorite } from './model';

export function DeleteFavoriteDialog({
    favorite,
    onCancel,
    onConfirm,
}: {
    favorite: Favorite;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    const returnFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const title = useId();
    const description = useId();
    useEffect(() => {
        const target = returnFocus.current;
        const element = dialog.current!;
        element.showModal();
        return () => {
            element.close();
            if (target?.isConnected) target.focus();
        };
    }, []);

    return createPortal(
        <dialog
            ref={dialog}
            className="confirmation-modal"
            aria-labelledby={title}
            aria-describedby={description}
            onCancel={onCancel}
        >
            <h2 id={title}>Delete favorite?</h2>
            <p id={description}>
                Remove <strong>{favorite.name}</strong> from your favorites? You can add it again later.
            </p>
            <p className="muted modal-url">{favorite.url}</p>
            <div className="button-row">
                <button type="button" autoFocus onClick={onCancel}>
                    Cancel
                </button>
                <button type="button" className="danger" onClick={onConfirm}>
                    Delete favorite
                </button>
            </div>
        </dialog>,
        document.body
    );
}

import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Eye, EyeOff } from 'lucide-react';
import { isAppleTouchDevice } from './device';
import type { Favorite } from './model';

export function VisibilityDialog({
    groups,
    hiddenGroups,
    favorites,
    busy,
    blocked,
    error,
    onToggleGroup,
    onToggleFavorite,
    onClose,
}: {
    groups: string[];
    hiddenGroups: string[];
    favorites: Favorite[];
    busy: boolean;
    blocked: boolean;
    error: string;
    onToggleGroup: (name: string) => void;
    onToggleFavorite: (favorite: Favorite) => void;
    onClose: () => void;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    const heading = useRef<HTMLHeadingElement>(null);
    const close = useRef<HTMLButtonElement>(null);
    const title = useId();

    useEffect(() => {
        const element = dialog.current!;
        element.showModal();
        (isAppleTouchDevice() ? heading : close).current?.focus();
        return () => element.close();
    }, []);

    return createPortal(
        <dialog
            ref={dialog}
            className="confirmation-modal visibility-dialog"
            aria-labelledby={title}
            onCancel={(event) => {
                event.preventDefault();
                onClose();
            }}
        >
            <div className="section-heading">
                <h2 id={title} ref={heading} tabIndex={-1}>
                    Visibility
                </h2>
                <button ref={close} type="button" aria-label="Close visibility" onClick={onClose}>
                    Close
                </button>
            </div>
            <p className="muted">
                Use the eye buttons to show or hide groups and favorites. Hidden groups also hide their assigned
                favorites. Each favorite keeps its own visibility setting.
            </p>
            {error && (
                <p className="error" role="alert">
                    {error}
                </p>
            )}
            <section aria-labelledby={`${title}-groups`}>
                <h3 id={`${title}-groups`}>Groups</h3>
                {groups.length > 0 ? (
                    <ul>
                        {groups.map((group) => {
                            const hidden = hiddenGroups.includes(group);
                            return (
                                <li key={group}>
                                    <span>
                                        {group}
                                        <small>{hidden ? 'Hidden' : 'Shown'}</small>
                                    </span>
                                    <button
                                        type="button"
                                        aria-label={`${hidden ? 'Show' : 'Hide'} group ${group}`}
                                        disabled={busy || blocked}
                                        onClick={() => onToggleGroup(group)}
                                    >
                                        {hidden ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                ) : (
                    <p className="muted">No groups yet. Create one from the Group menu.</p>
                )}
            </section>
            {favorites.length > 0 && (
                <section aria-labelledby={`${title}-favorites`}>
                    <h3 id={`${title}-favorites`}>Favorites</h3>
                    <ul>
                        {favorites.map((favorite) => {
                            const hiddenBy = favorite.groups?.filter((group) => hiddenGroups.includes(group)) ?? [];
                            return (
                                <li key={favorite.id}>
                                    <span>
                                        {favorite.name}
                                        <small>{favorite.hidden ? 'Hidden individually' : 'Shown individually'}</small>
                                        {hiddenBy.length > 0 && <small>Hidden by group: {hiddenBy.join(', ')}</small>}
                                    </span>
                                    <button
                                        type="button"
                                        aria-label={`${favorite.hidden ? 'Show' : 'Hide'} favorite ${favorite.name}`}
                                        disabled={busy || blocked}
                                        onClick={() => onToggleFavorite(favorite)}
                                    >
                                        {favorite.hidden ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </section>
            )}
            {!groups.length && !favorites.length && <p>No groups or favorites.</p>}
        </dialog>,
        document.body
    );
}

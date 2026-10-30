import { useDelayedLoading } from './useDelayedLoading';

export function LoadingSpinner({
    isLoading,
    label,
    small = false,
    className = '',
}: {
    isLoading: boolean;
    label: string;
    small?: boolean;
    className?: string;
}) {
    const visible = useDelayedLoading(isLoading);
    if (!visible) return null;
    return (
        <div className={`loading-indicator ${className}`} role="status" aria-label={label}>
            <span className={`loading-ring${small ? ' loading-ring-small' : ''}`} aria-hidden="true" />
            <span className="sr-only">{label}</span>
        </div>
    );
}

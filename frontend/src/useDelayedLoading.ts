import { useEffect, useState } from 'react';

export function useDelayedLoading(isLoading: boolean, delayMs = 250): boolean {
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        setVisible(false);
        if (!isLoading) return;
        const timer = setTimeout(() => setVisible(true), delayMs);
        return () => clearTimeout(timer);
    }, [isLoading, delayMs]);
    return isLoading && visible;
}

import { useEffect, useLayoutEffect, useState, type RefCallback } from 'react';
import { LoadingSpinner } from './LoadingSpinner';

export function EmbeddedSite({
    identity,
    url,
    label,
    active,
    revealedSites,
    frameRef,
}: {
    identity: string;
    url: string;
    label: string;
    active: boolean;
    revealedSites: Set<string>;
    frameRef: RefCallback<HTMLIFrameElement>;
}) {
    const [ready, setReady] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [firstReveal, setFirstReveal] = useState(false);
    const [firstVisit] = useState(() => !revealedSites.has(identity));

    useEffect(() => {
        if (!active || ready) return;
        const timer = setTimeout(() => setReady(true), 4000);
        return () => clearTimeout(timer);
    }, [active, ready]);

    useLayoutEffect(() => {
        if (!ready || !active || revealedSites.has(identity)) return;
        revealedSites.add(identity);
        setFirstReveal(true);
    }, [ready, active, identity, revealedSites]);

    return (
        <>
            <iframe
                ref={frameRef}
                title={label}
                src={url}
                className={`site-frame${active ? ' active' : ''}${loaded ? ' loaded' : ''}${ready ? ' ready' : ''}${firstReveal ? ' first-reveal' : ''}`}
                aria-hidden={active ? undefined : true}
                inert={!active}
                onLoad={() => {
                    setLoaded(true);
                    setReady(true);
                }}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                referrerPolicy="no-referrer"
            />
            <LoadingSpinner
                isLoading={active && !ready && firstVisit}
                label={`Loading ${label}`}
                className="frame-loading"
            />
        </>
    );
}

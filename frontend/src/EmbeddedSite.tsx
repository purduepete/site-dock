import { useEffect, useLayoutEffect, useState, type RefCallback } from 'react';

export function EmbeddedSite({
    identity,
    url,
    label,
    active,
    revealedSites,
    frameRef,
    onOpenTab,
}: {
    identity: string;
    url: string;
    label: string;
    active: boolean;
    revealedSites: Set<string>;
    frameRef: RefCallback<HTMLIFrameElement>;
    onOpenTab: () => void;
}) {
    const [loaded, setLoaded] = useState(false);
    const [waiting, setWaiting] = useState(false);
    const [firstReveal, setFirstReveal] = useState(false);

    useEffect(() => {
        if (!active || loaded || waiting) return;
        const timer = setTimeout(() => setWaiting(true), 4000);
        return () => clearTimeout(timer);
    }, [active, loaded, waiting]);

    useLayoutEffect(() => {
        if (!loaded || !active || revealedSites.has(identity)) return;
        revealedSites.add(identity);
        setFirstReveal(true);
    }, [loaded, active, identity, revealedSites]);

    return (
        <>
            <iframe
                ref={frameRef}
                title={label}
                src={url}
                className={`site-frame${active ? ' active' : ''}${loaded ? ' loaded ready' : ''}${firstReveal ? ' first-reveal' : ''}`}
                aria-hidden={active ? undefined : true}
                inert={!active}
                onAnimationEnd={() => setFirstReveal(false)}
                onLoad={() => setLoaded(true)}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                referrerPolicy="no-referrer"
            />
            {active && waiting && !loaded && (
                <section className="empty-state" role="status" aria-label={`Waiting for ${label}`}>
                    <p>{label} is taking longer to load.</p>
                    <a
                        className="button primary"
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={onOpenTab}
                    >
                        Open in new tab
                    </a>
                </section>
            )}
        </>
    );
}

// SiteDock token handoff. Safari erases localStorage inside a cross-site iframe when the browser
// closes, so an app embedded in SiteDock can keep a copy of its sign-in token in SiteDock instead:
//   <script src="https://<your-sitedock-host>/sitedock-token.js"><\/script>
//   const token = localStorage.getItem('my-token') || await SiteDockToken.get();
//   SiteDockToken.save(token);   // after sign-in
//   SiteDockToken.clear();       // on sign-out or a rejected token
// When inlined or bundled, set the SiteDock origin explicitly:
//   <script data-sitedock-origin="https://<your-sitedock-host>">...<\/script>
// Every call resolves (get() to null) when the page is not framed directly by that SiteDock origin.
(() => {
    const script = document.currentScript || document.querySelector('script[data-sitedock-origin]');
    let origin = '';
    try {
        origin = new URL(script?.getAttribute('data-sitedock-origin') || script?.src || '').origin;
    } catch {
        origin = '';
    }
    const ancestors = window.location.ancestorOrigins;
    // ancestorOrigins is missing in Firefox; there the reply's origin check still applies.
    // Only a direct child of the top-level SiteDock page takes part.
    const framed =
        window.top !== window &&
        window.parent === window.top &&
        !!origin &&
        origin !== 'null' &&
        (!ancestors || ancestors.length === 0 || (ancestors.length === 1 && ancestors[0] === origin));
    let next = 0;

    function request(op, token) {
        if (!framed) return Promise.resolve(op === 'get' ? null : false);
        const id = `t${Date.now().toString(36)}${(next++).toString(36)}`;
        return new Promise((resolve) => {
            const done = (value) => {
                clearTimeout(timer);
                window.removeEventListener('message', reply);
                resolve(value);
            };
            const timer = setTimeout(() => done(op === 'get' ? null : false), 1500);
            function reply(event) {
                if (event.source !== window.parent || event.origin !== origin) return;
                const data = event.data;
                if (!data || data.type !== 'sitedock:token' || data.id !== id) return;
                if (op === 'get') done(data.op === 'value' && typeof data.token === 'string' ? data.token : null);
                else done(data.op === 'ok');
            }
            window.addEventListener('message', reply);
            window.parent.postMessage(
                token === undefined ? { type: 'sitedock:token', op, id } : { type: 'sitedock:token', op, id, token },
                origin
            );
        });
    }

    window.SiteDockToken = Object.freeze({
        get: () => request('get'),
        save: (token) => (typeof token === 'string' && token ? request('save', token) : Promise.resolve(false)),
        clear: () => request('clear'),
    });
})();

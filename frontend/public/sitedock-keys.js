// SiteDock key forwarder. Include this in an app you embed in SiteDock so Alt+1..9 and Alt+G
// work while the embedded app has focus:
//   <script src="https://<your-sitedock-host>/sitedock-keys.js"><\/script>
// When inlined or bundled, set the SiteDock origin explicitly:
//   <script data-sitedock-origin="https://<your-sitedock-host>">...<\/script>
(() => {
  if (window.top === window) return;
  // document.currentScript is only set while the script first runs.
  const script = document.currentScript || document.querySelector('script[data-sitedock-origin]');
  let origin = '';
  try {
    origin = new URL(script?.getAttribute('data-sitedock-origin') || script?.src || '').origin;
  } catch {
    return;
  }
  if (!origin || origin === 'null') return;
  const editable = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
  window.addEventListener('keydown', event => {
    if (!event.altKey || event.ctrlKey || event.shiftKey || event.metaKey || event.repeat || event.isComposing || event.defaultPrevented) return;
    if (event.getModifierState && event.getModifierState('AltGraph')) return;
    if (!/^((Digit|Numpad)[1-9]|KeyG)$/.test(event.code)) return;
    if (event.target instanceof Element && event.target.closest(editable)) return;
    event.preventDefault();
    window.parent.postMessage({ type: 'sitedock:key', code: event.code }, origin);
  });
})();

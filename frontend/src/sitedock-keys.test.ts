// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import source from '../public/sitedock-keys.js?raw';

function loadForwarder() {
  let listener: ((event: Partial<KeyboardEvent>) => void) | undefined;
  const postMessage = vi.fn();
  const framed = { top: {}, parent: { postMessage }, addEventListener: (_type: string, handler: typeof listener) => { listener = handler; } };
  const script = { getAttribute: (name: string) => name === 'data-sitedock-origin' ? 'https://dock.example.com' : null };
  const fakeDocument = { currentScript: script, querySelector: () => script };
  new Function('window', 'document', source)(framed, fakeDocument);
  const press = (code: string, extra: Partial<KeyboardEvent> = {}) => {
    const preventDefault = vi.fn();
    listener!({ code, altKey: true, ctrlKey: false, shiftKey: false, metaKey: false, repeat: false, isComposing: false, defaultPrevented: false, target: document.body, preventDefault, ...extra });
    return preventDefault;
  };
  return { postMessage, press };
}

describe('sitedock-keys forwarder', () => {
  it('forwards Alt+0 through Alt+9 and Alt+G to the SiteDock origin', () => {
    const { postMessage, press } = loadForwarder();
    for (const code of ['Digit0', 'Numpad0', 'Digit1', 'Digit9', 'KeyG']) expect(press(code)).toHaveBeenCalledOnce();
    expect(postMessage.mock.calls.map(call => call[0].code)).toEqual(['Digit0', 'Numpad0', 'Digit1', 'Digit9', 'KeyG']);
    expect(postMessage.mock.calls.every(call => call[1] === 'https://dock.example.com')).toBe(true);
  });
  it('ignores other keys and modifiers', () => {
    const { postMessage, press } = loadForwarder();
    press('KeyH');
    press('Digit0', { ctrlKey: true });
    press('Digit0', { altKey: false });
    expect(postMessage).not.toHaveBeenCalled();
  });
});

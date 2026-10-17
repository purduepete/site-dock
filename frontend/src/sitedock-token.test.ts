// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import source from '../public/sitedock-token.js?raw';

type Api = { get: () => Promise<string | null>; save: (token: unknown) => Promise<boolean>; clear: () => Promise<boolean> };

function load({ framed = true, ancestors = ['https://dock.example.com'] as string[] | undefined } = {}) {
  const listeners = new Set<(event: Partial<MessageEvent>) => void>();
  const postMessage = vi.fn();
  const parent = { postMessage };
  const fake: Record<string, unknown> = {
    parent, location: { ancestorOrigins: ancestors },
    addEventListener: (_type: string, handler: (event: Partial<MessageEvent>) => void) => listeners.add(handler),
    removeEventListener: (_type: string, handler: (event: Partial<MessageEvent>) => void) => listeners.delete(handler),
  };
  fake.top = framed ? parent : fake;
  const script = { getAttribute: (name: string) => name === 'data-sitedock-origin' ? 'https://dock.example.com' : null };
  new Function('window', 'document', source)(fake, { currentScript: script, querySelector: () => script });
  const deliver = (event: Partial<MessageEvent>) => { for (const listener of [...listeners]) listener(event); };
  return { api: fake.SiteDockToken as Api, postMessage, parent, deliver };
}

describe('sitedock-token handoff', () => {
  it('asks the SiteDock origin and accepts only its matching reply', async () => {
    const { api, postMessage, parent, deliver } = load();
    const pending = api.get();
    const [request, target] = postMessage.mock.calls[0];
    expect(target).toBe('https://dock.example.com');
    expect(request).toMatchObject({ type: 'sitedock:token', op: 'get' });
    deliver({ source: parent as unknown as MessageEventSource, origin: 'https://evil.example', data: { type: 'sitedock:token', op: 'value', id: request.id, token: 'bad' } });
    deliver({ source: null, origin: 'https://dock.example.com', data: { type: 'sitedock:token', op: 'value', id: request.id, token: 'bad' } });
    deliver({ source: parent as unknown as MessageEventSource, origin: 'https://dock.example.com', data: { type: 'sitedock:token', op: 'value', id: 'other', token: 'bad' } });
    deliver({ source: parent as unknown as MessageEventSource, origin: 'https://dock.example.com', data: { type: 'sitedock:token', op: 'value', id: request.id, token: 'good' } });
    await expect(pending).resolves.toBe('good');
  });
  it('sends save and clear with the token to the exact origin', async () => {
    const { api, postMessage, parent, deliver } = load();
    const saved = api.save('secret');
    const [request, target] = postMessage.mock.calls[0];
    expect(request).toMatchObject({ op: 'save', token: 'secret' });
    expect(target).toBe('https://dock.example.com');
    deliver({ source: parent as unknown as MessageEventSource, origin: 'https://dock.example.com', data: { type: 'sitedock:token', op: 'ok', id: request.id } });
    await expect(saved).resolves.toBe(true);
    await expect(api.save('')).resolves.toBe(false);
    expect(postMessage).toHaveBeenCalledOnce();
  });
  it('never posts when unframed or framed by another origin', async () => {
    for (const options of [{ framed: false }, { ancestors: ['https://evil.example'] }, { ancestors: ['https://dock.example.com', 'https://evil.example'] }]) {
      const { api, postMessage } = load(options);
      await expect(api.get()).resolves.toBeNull();
      await expect(api.save('secret')).resolves.toBe(false);
      expect(postMessage).not.toHaveBeenCalled();
    }
  });
  it('resolves get() to null when SiteDock does not answer', async () => {
    vi.useFakeTimers();
    try {
      const { api } = load();
      const pending = api.get();
      vi.advanceTimersByTime(1500);
      await expect(pending).resolves.toBeNull();
    } finally { vi.useRealTimers(); }
  });
});

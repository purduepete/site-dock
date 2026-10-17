// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetOrphanedTokens } from './tokens';

describe('forgetOrphanedTokens', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    });
  });
  it('removes tokens only for origins no remaining favorite uses', () => {
    localStorage.setItem('sitedock-token:https://a.example', 'a');
    localStorage.setItem('sitedock-token:https://b.example', 'b');
    localStorage.setItem('sitedock-token:https://c.example', 'c');
    forgetOrphanedTokens(
      [{ url: 'https://a.example/x' }, { url: 'https://b.example/' }, { url: 'https://b.example/other' }],
      [{ url: 'https://b.example/other' }, { url: 'https://new.example/' }],
    );
    expect(localStorage.getItem('sitedock-token:https://a.example')).toBeNull();
    expect(localStorage.getItem('sitedock-token:https://b.example')).toBe('b');
    expect(localStorage.getItem('sitedock-token:https://c.example')).toBe('c');
  });
});

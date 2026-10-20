// Device-local copies of embedded apps' sign-in tokens. Safari makes a cross-site iframe's
// localStorage ephemeral, so an app can hand its token to SiteDock (first-party, persistent)
// and ask for it back on the next load. Tokens never leave this browser.

export const TOKEN_MESSAGE = 'sitedock:token';
export const MAX_TOKEN_LENGTH = 4096;
const prefix = 'sitedock-token:';

export type TokenRequest = { op: 'get' | 'save' | 'clear'; id: string; token?: string };
export type TokenReply = {
    type: typeof TOKEN_MESSAGE;
    op: 'value' | 'ok' | 'error';
    id: string;
    token?: string | null;
};

export function readToken(origin: string): string | null {
    try {
        return localStorage.getItem(prefix + origin);
    } catch {
        return null;
    }
}

export function writeToken(origin: string, token: string | null): boolean {
    try {
        if (token === null) localStorage.removeItem(prefix + origin);
        else localStorage.setItem(prefix + origin, token);
        return true;
    } catch {
        return false;
    }
}

export function parseTokenRequest(data: unknown): TokenRequest | null {
    if (!data || typeof data !== 'object') return null;
    const { type, op, id, token } = data as Record<string, unknown>;
    if (type !== TOKEN_MESSAGE || typeof id !== 'string' || !id || id.length > 100) return null;
    if (op === 'get' || op === 'clear') return { op, id };
    if (op === 'save' && typeof token === 'string' && token.length > 0 && token.length <= MAX_TOKEN_LENGTH)
        return { op, id, token };
    return null;
}

// Applies a validated request for the frame's own origin and returns the reply to post back.
export function handleTokenRequest(request: TokenRequest, origin: string): TokenReply {
    if (request.op === 'get') return { type: TOKEN_MESSAGE, op: 'value', id: request.id, token: readToken(origin) };
    const stored = writeToken(origin, request.op === 'save' ? request.token! : null);
    return { type: TOKEN_MESSAGE, op: stored ? 'ok' : 'error', id: request.id };
}

export function originOf(url: string): string | null {
    try {
        const origin = new URL(url).origin;
        return origin === 'null' ? null : origin;
    } catch {
        return null;
    }
}

// After a save, drops tokens for origins that no remaining favorite uses.
export function forgetOrphanedTokens(before: { url: string }[], after: { url: string }[]): void {
    const kept = new Set(after.map((item) => originOf(item.url)));
    for (const item of before) {
        const origin = originOf(item.url);
        if (origin && !kept.has(origin)) writeToken(origin, null);
    }
}

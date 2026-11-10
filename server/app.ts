import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import type { Config } from './config.js';
import { Storage, readOwner, verifyPassword, ValidationError, ConflictError, type StorageBackend } from './storage.js';

const WEEK = 7 * 24 * 60 * 60 * 1000;
const PREFERENCES_AGE = 400 * 24 * 60 * 60;
const MAX_BODY = 1024 * 1024;
const crossOriginScripts = new Set(['/sitedock-keys.js', '/sitedock-token.js']);
interface Session {
    username: string;
    version: string;
    expires: number;
}
interface Options {
    now?: () => number;
    storage?: StorageBackend;
}
class SetupRequiredError extends Error {}

function header(req: IncomingMessage, name: string): string | undefined {
    const values = req.rawHeaders.filter(
        (_, index) => index % 2 === 0 && req.rawHeaders[index]?.toLowerCase() === name
    ).length;
    if (values > 1) throw new ValidationError('Duplicate request metadata.');
    const value = req.headers[name];
    if (Array.isArray(value)) throw new ValidationError('Invalid request metadata.');
    return value;
}

export function requestOrigin(req: IncomingMessage, config: Config): { origin: string; secure: boolean } {
    const host = header(req, 'host');
    if (!host || host.includes(',') || /\s/.test(host)) throw new ValidationError('Invalid Host.');
    const proto = header(req, 'x-forwarded-proto');
    const forwardedHost = header(req, 'x-forwarded-host');
    const forwardedPort = header(req, 'x-forwarded-port');
    if (header(req, 'forwarded') !== undefined) throw new ValidationError('Unexpected forwarded metadata.');
    const remoteOrigin = (config.remoteOrigins ?? (config.remoteOrigin ? [config.remoteOrigin] : [])).find(
        (value) => host === new URL(value).host
    );
    if (remoteOrigin && proto === 'https') {
        const expectedPort = new URL(remoteOrigin).port || '443';
        if (
            (forwardedHost !== undefined && forwardedHost !== host) ||
            (forwardedPort !== undefined && forwardedPort !== expectedPort)
        )
            throw new ValidationError('Conflicting forwarded metadata.');
        return { origin: remoteOrigin, secure: true };
    }
    if (
        proto !== undefined ||
        forwardedHost !== undefined ||
        forwardedPort !== undefined ||
        !config.localOrigins.includes(`http://${host}`)
    )
        throw new ValidationError('Host or forwarded protocol is not allowed.');
    return { origin: `http://${host}`, secure: false };
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(header(req, 'content-type') ?? ''))
        throw new ValidationError('Content-Type must be application/json.');
    let length = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
        length += chunk.length;
        if (length > MAX_BODY) throw new ValidationError('Request body exceeds 1 MiB.');
        chunks.push(chunk as Buffer);
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
        throw new ValidationError('Invalid JSON body.');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new ValidationError('A JSON object is required.');
    return parsed as Record<string, unknown>;
}

export function createApp(config: Config, options: Options = {}) {
    if (process.env.STORAGE_BACKEND === 'postgresql' && !options.storage)
        throw new Error('PostgreSQL storage must be initialized before creating SiteDock.');
    const remoteOrigins = config.remoteOrigins ?? (config.remoteOrigin ? [config.remoteOrigin] : []);
    const gatewayAuth = config.authMode === 'gateway';
    const storage: StorageBackend =
        options.storage ?? new Storage(config.dataDir, [...config.localOrigins, ...remoteOrigins]);
    const now = options.now ?? Date.now;
    const sessions = new Map<string, Session>();
    let failures = 0;
    let retryAt = 0;
    let loginBusy = false;
    const ownerRecord = async () => {
        try {
            return await readOwner(config.dataDir);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT')
                throw new SetupRequiredError(
                    'Owner setup is required. Run the local owner setup command in a terminal.'
                );
            throw error;
        }
    };
    const send = (res: ServerResponse, status: number, value: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(value));
    };
    const pendingRequests = new Set<Promise<void>>();
    const server = createServer((req, res) => {
        const pending = handleRequest(req, res);
        pendingRequests.add(pending);
        void pending.then(
            () => pendingRequests.delete(pending),
            () => pendingRequests.delete(pending)
        );
    });
    async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader(
            'Content-Security-Policy',
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: http: https:; connect-src 'self'; frame-src http: https:; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'"
        );
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        try {
            const { origin, secure } = requestOrigin(req, config);
            const path = new URL(req.url ?? '/', origin).pathname;
            const cookieName = secure ? '__Host-sitedock' : 'sitedock';
            const token = (header(req, 'cookie') ?? '')
                .split(';')
                .map((v) => v.trim())
                .find((v) => v.startsWith(`${cookieName}=`))
                ?.slice(cookieName.length + 1);
            const cookie = (value: string, age: number) =>
                `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
            if (!['GET', 'HEAD'].includes(req.method ?? '')) {
                if (header(req, 'origin') !== origin) {
                    send(res, 403, { error: 'An exact same-origin Origin header is required.' });
                    return;
                }
            }
            if (path === '/api/health' && req.method === 'GET') {
                await storage.ready?.();
                send(res, 200, { ok: true });
                return;
            }
            if (path === '/api/login' && req.method === 'POST') {
                if (gatewayAuth) {
                    send(res, 404, { error: 'SiteDock password login is disabled by gateway authentication.' });
                    return;
                }
                if (loginBusy || now() < retryAt) {
                    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((retryAt - now()) / 1000))));
                    send(res, 429, { error: 'Login temporarily throttled. Try again later.' });
                    return;
                }
                loginBusy = true;
                try {
                    const input = await body(req);
                    if (
                        typeof input.username !== 'string' ||
                        input.username.length > 80 ||
                        typeof input.password !== 'string' ||
                        input.password.length > 1024
                    )
                        throw new ValidationError('Invalid login fields.');
                    const owner = await ownerRecord();
                    const valid = await verifyPassword(owner, input.username, input.password);
                    const latest = await ownerRecord();
                    if (!valid || owner.version !== latest.version) {
                        failures = Math.min(failures + 1, 10);
                        retryAt = now() + Math.min(60_000, 500 * 2 ** (failures - 1));
                        send(res, 401, { error: 'Invalid username or password.' });
                        return;
                    }
                    failures = 0;
                    retryAt = 0;
                    for (const [key, session] of sessions) if (session.expires <= now()) sessions.delete(key);
                    if (token) sessions.delete(token);
                    while (sessions.size >= 100) sessions.delete(sessions.keys().next().value!);
                    const fresh = randomBytes(32).toString('base64url');
                    sessions.set(fresh, { username: owner.username, version: owner.version, expires: now() + WEEK });
                    res.setHeader('Set-Cookie', cookie(fresh, WEEK / 1000));
                    send(res, 200, { authenticated: true, username: owner.username });
                } finally {
                    loginBusy = false;
                }
                return;
            }
            if (path === '/api/logout' && req.method === 'POST') {
                await body(req);
                if (gatewayAuth) {
                    send(res, 200, { authenticated: true, gatewayAuthenticated: true });
                    return;
                }
                if (token) sessions.delete(token);
                res.setHeader('Set-Cookie', cookie('', 0));
                send(res, 200, { authenticated: false });
                return;
            }
            if (path === '/api/preferences' && req.method === 'POST') {
                const input = await body(req);
                const entries = Object.entries(input);
                if (
                    entries.length > 20 ||
                    entries.some(([key, value]) => !/^[a-z-]{1,40}$/.test(key) || typeof value !== 'string')
                )
                    throw new ValidationError('Preferences must map short lowercase keys to strings.');
                const value = encodeURIComponent(JSON.stringify(input));
                if (value.length > 3000) throw new ValidationError('Preferences are too large.');
                // Safari purges localStorage a day after a Cloudflare Access redirect; server-set cookies survive.
                res.setHeader(
                    'Set-Cookie',
                    `${secure ? '__Host-' : ''}sitedock-prefs=${value}; Path=/; SameSite=Lax; Max-Age=${PREFERENCES_AGE}${secure ? '; Secure' : ''}`
                );
                send(res, 200, { ok: true });
                return;
            }
            if (path === '/api/session' || path.startsWith('/api/favorites')) {
                let session = token ? sessions.get(token) : undefined;
                const owner = await ownerRecord();
                if (session && (session.expires <= now() || session.version !== owner.version)) {
                    if (token) sessions.delete(token);
                    session = undefined;
                }
                if (path === '/api/session' && req.method === 'GET') {
                    const allowedOrigins = [...config.localOrigins, ...remoteOrigins];
                    if (gatewayAuth) {
                        send(res, 200, { authenticated: true, gatewayAuthenticated: true, allowedOrigins });
                        return;
                    }
                    send(
                        res,
                        200,
                        session
                            ? { authenticated: true, username: session.username, allowedOrigins }
                            : { authenticated: false, allowedOrigins }
                    );
                    return;
                }
                if (!gatewayAuth && !session) {
                    send(res, 401, { error: 'Sign in to continue.' });
                    return;
                }
                if (path === '/api/favorites' && req.method === 'GET') {
                    send(res, 200, await storage.read());
                    return;
                }
                if (path === '/api/favorites' && req.method === 'PUT') {
                    const input = await body(req);
                    send(
                        res,
                        200,
                        await storage.update(
                            input.baseRevision,
                            input.favorites,
                            input.operation,
                            input.groups,
                            input.hiddenGroups
                        )
                    );
                    return;
                }
            }
            if (path.startsWith('/api/')) {
                send(res, 404, { error: 'API route not found.' });
                return;
            }
            if (req.method !== 'GET' && req.method !== 'HEAD') {
                send(res, 405, { error: 'Method not allowed.' });
                return;
            }
            let decoded: string;
            try {
                decoded = decodeURIComponent(path);
            } catch {
                throw new ValidationError('Invalid path.');
            }
            if (decoded.includes('\0') || decoded.includes('\\')) throw new ValidationError('Invalid path.');
            const root = resolve(config.distDir);
            let file = resolve(root, `.${decoded}`);
            if (file !== root && !file.startsWith(root + sep)) {
                send(res, 404, { error: 'Not found.' });
                return;
            }
            if (decoded.split('/').some((part) => part.startsWith('.'))) {
                send(res, 404, { error: 'Not found.' });
                return;
            }
            if (decoded === '/' || !extname(decoded)) file = resolve(root, 'index.html');
            let content: Buffer;
            try {
                content = await readFile(file);
            } catch {
                send(res, 404, { error: 'Not found.' });
                return;
            }
            const mime: Record<string, string> = {
                '.html': 'text/html; charset=utf-8',
                '.js': 'text/javascript; charset=utf-8',
                '.css': 'text/css; charset=utf-8',
                '.svg': 'image/svg+xml',
                '.png': 'image/png',
                '.ico': 'image/x-icon',
                '.woff2': 'font/woff2',
            };
            res.writeHead(200, {
                'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
                ...(crossOriginScripts.has(decoded) ? { 'Cross-Origin-Resource-Policy': 'cross-origin' } : {}),
            });
            res.end(req.method === 'HEAD' ? undefined : content);
        } catch (error) {
            if (error instanceof SetupRequiredError) {
                send(res, 503, { error: error.message, setupRequired: true });
                return;
            }
            if (error instanceof ConflictError) {
                send(res, 409, { ...error.current, error: error.message });
                return;
            }
            if (error instanceof ValidationError) {
                send(res, 400, { error: error.message });
                return;
            }
            send(res, 503, { error: 'Local storage is unavailable. Check the data files and permissions.' });
        }
    }
    server.requestTimeout = 15_000;
    server.headersTimeout = 10_000;
    return Object.assign(server, {
        async drainRequests(): Promise<void> {
            await Promise.allSettled(pendingRequests);
        },
    });
}

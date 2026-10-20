import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import {
    acquireLock,
    atomicWrite,
    ConflictError,
    readOwner,
    Storage,
    validateFavorites,
    validateGroups,
    validateReorder,
    verifyPassword,
    writeOwner,
} from './storage.js';

const favorite = { id: 'one', name: 'One', url: 'https://example.com/', mode: 'embed' as const };
async function fixture(run: (directory: string) => Promise<void>) {
    const directory = resolve('server', `.test-data-${randomUUID()}`);
    await mkdir(directory, { recursive: true });
    try {
        await run(directory);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

test('config validates ports and exact HTTPS origins', () => {
    assert.equal(loadConfig({}).port, 8790);
    assert.throws(() => loadConfig({ SITEDOCK_PORT: '0' }));
    assert.throws(() => loadConfig({ SITEDOCK_REMOTE_ORIGIN: 'http://example.com' }));
    assert.throws(() => loadConfig({ SITEDOCK_REMOTE_ORIGIN: 'https://example.com/path' }));
    assert.equal(
        loadConfig({ SITEDOCK_REMOTE_ORIGIN: 'https://example.com:8443/' }).remoteOrigin,
        'https://example.com:8443'
    );
    assert.deepEqual(
        loadConfig({ SITEDOCK_REMOTE_ORIGINS: 'https://dock.example, https://tail.example:8443' }).remoteOrigins,
        ['https://dock.example', 'https://tail.example:8443']
    );
    assert.throws(() => loadConfig({ SITEDOCK_REMOTE_ORIGINS: 'https://dock.example,not-an-origin' }));
    assert.equal(loadConfig({}).authMode, 'owner');
    assert.equal(loadConfig({ SITEDOCK_AUTH_MODE: 'gateway' }).authMode, 'gateway');
    assert.throws(() => loadConfig({ SITEDOCK_AUTH_MODE: 'headers' }));
    assert.throws(() => loadConfig({ SITEDOCK_DEV_ORIGIN: 'http://127.0.0.1:5173' }));
    assert.throws(() => loadConfig({ NODE_ENV: 'production', SITEDOCK_DEV_ORIGIN: 'http://127.0.0.1:5173' }));
    assert.throws(() => loadConfig({ NODE_ENV: 'development', SITEDOCK_DEV_ORIGIN: 'http://evil.example:5173' }));
    assert.ok(
        loadConfig({ NODE_ENV: 'development', SITEDOCK_DEV_ORIGIN: 'http://127.0.0.1:5173' }).localOrigins.includes(
            'http://127.0.0.1:5173'
        )
    );
});

test('favorite and full-ID reorder validation', () => {
    assert.deepEqual(validateFavorites([favorite]), [favorite]);
    for (const url of ['javascript:alert(1)', 'file:///x', 'https://u:p@example.com', 'https://dock.example']) {
        assert.throws(() => validateFavorites([{ ...favorite, url }], ['https://dock.example']));
    }
    for (const list of [
        [favorite, favorite],
        [{ ...favorite, name: '' }],
        [{ ...favorite, id: '../bad' }],
        [{ ...favorite, mode: 'other' }],
    ]) {
        assert.throws(() => validateFavorites(list));
    }
    assert.throws(() => validateFavorites(Array.from({ length: 201 }, () => favorite)));
    assert.deepEqual(validateReorder([favorite], ['one']), ['one']);
    for (const ids of [[], ['other'], ['one', 'one']]) assert.throws(() => validateReorder([favorite], ids));
});

test('storage seeds once, preserves empty lists, serializes and rejects conflicts', async () =>
    fixture(async (directory) => {
        const storage = new Storage(directory);
        await storage.initialize();
        assert.equal((await storage.read()).favorites.length, 4);
        await storage.update(0, []);
        await storage.initialize();
        assert.deepEqual(await storage.read(), { revision: 1, favorites: [], groups: [] });
        const results = await Promise.allSettled([storage.update(1, [favorite]), storage.update(1, [])]);
        assert.equal(results[0].status, 'fulfilled');
        assert.equal(results[1].status, 'rejected');
        if (results[1].status === 'rejected') assert.ok(results[1].reason instanceof ConflictError);
        assert.deepEqual(JSON.parse(await readFile(join(directory, 'favorites.json.bak'), 'utf8')), {
            revision: 1,
            favorites: [],
            groups: [],
        });
        await assert.rejects(storage.update(-1, []));
        await writeFile(join(directory, 'favorites.json'), '{broken');
        await assert.rejects(storage.initialize());
        assert.equal(await readFile(join(directory, 'favorites.json'), 'utf8'), '{broken');
    }));

test('group validation rejects duplicates, invalid names and invalid favorite assignments', () => {
    assert.deepEqual(validateGroups([' Personal ', 'Sports']), ['Personal', 'Sports']);
    for (const value of [
        null,
        'Personal',
        [''],
        ['a'.repeat(51)],
        ['Personal', 'personal'],
        Array.from({ length: 51 }, (_, index) => String(index)),
    ]) {
        assert.throws(() => validateGroups(value));
    }
    assert.deepEqual(validateFavorites([{ ...favorite, group: ' Personal ' }]), [
        { ...favorite, groups: ['Personal'] },
    ]);
    assert.deepEqual(validateFavorites([{ ...favorite, groups: [' Personal ', 'Sports'] }]), [
        { ...favorite, groups: ['Personal', 'Sports'] },
    ]);
    assert.deepEqual(validateFavorites([{ ...favorite, groups: [] }]), [favorite]);
    for (const groups of [null, 'Personal', ['Personal', 'personal'], [1], ['']])
        assert.throws(() => validateFavorites([{ ...favorite, groups }]));
    assert.throws(() => validateFavorites([{ ...favorite, group: 'Personal', groups: ['Sports'] }]));
    for (const group of [null, 1, '', ' ', 'a'.repeat(51)])
        assert.throws(() => validateFavorites([{ ...favorite, group }]));
});

test('groups persist with empty groups, legacy data, revision conflicts and reorder boundaries', async () =>
    fixture(async (directory) => {
        const storage = new Storage(directory);
        await writeFile(join(directory, 'favorites.json'), JSON.stringify({ revision: 4, favorites: [favorite] }));
        const legacyText = await readFile(join(directory, 'favorites.json'), 'utf8');
        assert.deepEqual(await storage.read(), { revision: 4, favorites: [favorite], groups: [] });
        assert.equal(await readFile(join(directory, 'favorites.json'), 'utf8'), legacyText);
        const grouped = { ...favorite, groups: ['Personal', 'Sports'] };
        const saved = await storage.update(4, [grouped], undefined, ['Personal', 'Sports']);
        assert.deepEqual(saved.groups, ['Personal', 'Sports']);
        assert.deepEqual(await new Storage(directory).read(), saved);
        await assert.rejects(storage.update(4, [], undefined, ['News']), ConflictError);
        await assert.rejects(storage.update(5, [{ ...favorite, group: 'News' }]));
        await assert.rejects(storage.update(5, [grouped], undefined, []));
        await assert.rejects(storage.update(5, [favorite], 'reorder'));
        await assert.rejects(storage.update(5, [grouped], 'reorder', ['Personal']));
        assert.deepEqual((await storage.update(5, [grouped], 'reorder')).groups, saved.groups);
        const empty = await storage.update(6, []);
        assert.deepEqual(empty.groups, ['Personal', 'Sports']);
        assert.deepEqual(empty.favorites, []);
    }));

test('legacy single-group records are read as multiple memberships without rewriting the file', async () =>
    fixture(async (directory) => {
        const path = join(directory, 'favorites.json');
        const record = JSON.stringify({
            revision: 8,
            groups: ['Sports'],
            favorites: [{ ...favorite, group: 'Sports' }],
        });
        await writeFile(path, record);
        const storage = new Storage(directory);
        const current = await storage.read();
        assert.deepEqual(current.favorites, [{ ...favorite, groups: ['Sports'] }]);
        assert.equal(await readFile(path, 'utf8'), record);
        const updated = await storage.update(8, [{ ...favorite, groups: ['Sports', 'Personal'] }], undefined, [
            'Sports',
            'Personal',
        ]);
        assert.deepEqual((await storage.read()).favorites, updated.favorites);
        assert.deepEqual(updated.favorites[0].groups, ['Sports', 'Personal']);
        await assert.rejects(storage.update(9, [{ ...favorite, groups: ['Sports'] }], 'reorder'));
        await assert.rejects(storage.update(9, [{ ...favorite, groups: ['Unknown'] }]));
        const cleared = await storage.update(9, [favorite]);
        assert.deepEqual(cleared.favorites, [favorite]);
    }));

test('atomic replacement failure preserves original and backup', async () =>
    fixture(async (directory) => {
        const file = join(directory, 'record.json');
        await atomicWrite(file, { good: 1 });
        await atomicWrite(file, { good: 2 });
        assert.deepEqual(JSON.parse(await readFile(`${file}.bak`, 'utf8')), { good: 1 });
        await writeFile(file, 'corrupt');
        await assert.rejects(atomicWrite(file, { good: 3 }));
        assert.equal(await readFile(file, 'utf8'), 'corrupt');
        assert.deepEqual(JSON.parse(await readFile(`${file}.bak`, 'utf8')), { good: 1 });
    }));

test('one server writer per data directory', async () =>
    fixture(async (directory) => {
        const release = await acquireLock(directory);
        await assert.rejects(acquireLock(directory), /Another writer/);
        await release();
        const again = await acquireLock(directory);
        await again();
    }));

test('owner password is salted, reset changes version and validates bounds', async () =>
    fixture(async (directory) => {
        await assert.rejects(writeOwner(directory, 'owner', 'short'));
        const owner = await writeOwner(directory, 'owner', 'long password 123');
        await assert.rejects(writeOwner(directory, 'owner', 'another password', { setup: true }), /already exists/);
        assert.equal(await verifyPassword(owner, 'owner', 'long password 123'), true);
        assert.equal(await verifyPassword(owner, 'owner', 'incorrect'), false);
        assert.equal(await verifyPassword(owner, 'other', 'long password 123'), false);
        assert.equal((await readFile(join(directory, 'owner.json'), 'utf8')).includes('long password 123'), false);
        const changed = await writeOwner(directory, 'owner', 'new password 456');
        assert.notEqual(changed.version, owner.version);
        assert.notEqual(changed.salt, owner.salt);
        assert.equal((await readOwner(directory)).version, changed.version);
    }));

test('missing owner explicitly requires local setup and restart discards sessions', async () =>
    fixture(async (directory) => {
        const config = loadConfig({ SITEDOCK_DATA_DIR: directory });
        const storage = new Storage(directory);
        await storage.initialize();
        const start = async () => {
            const app = createApp(config, { storage });
            await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve));
            const address = app.address();
            assert.ok(address && typeof address === 'object');
            config.localOrigins = [`http://127.0.0.1:${address.port}`];
            return { app, url: config.localOrigins[0]! };
        };
        let running = await start();
        const close = async () =>
            new Promise<void>((resolve, reject) => running.app.close((error) => (error ? reject(error) : resolve())));
        try {
            const setup = await fetch(`${running.url}/api/session`);
            assert.equal(setup.status, 503);
            assert.equal(((await setup.json()) as { setupRequired: boolean }).setupRequired, true);
            await writeOwner(directory, 'owner', 'long password 123');
            const login = await fetch(`${running.url}/api/login`, {
                method: 'POST',
                headers: { Origin: running.url, 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: 'owner', password: 'long password 123' }),
            });
            assert.equal(login.status, 200);
            const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
            assert.equal((await fetch(`${running.url}/api/favorites`, { headers: { Cookie: cookie } })).status, 200);
            await close();
            running = await start();
            assert.equal((await fetch(`${running.url}/api/favorites`, { headers: { Cookie: cookie } })).status, 401);
        } finally {
            await close();
        }
    }));

test('HTTP authentication, persistence, reset, origin/proxy boundaries and static security', async () =>
    fixture(async (directory) => {
        const config = loadConfig({
            SITEDOCK_DATA_DIR: directory,
            SITEDOCK_REMOTE_ORIGIN: 'https://dock.example:8443',
        });
        config.distDir = join(directory, 'frontend');
        await mkdir(config.distDir);
        await writeFile(join(config.distDir, 'index.html'), '<!doctype html>SiteDock');
        await writeFile(join(config.distDir, 'sitedock-keys.js'), '// forwarder');
        await writeFile(join(config.distDir, 'sitedock-token.js'), '// token handoff');
        await writeFile(join(directory, 'private.txt'), 'private');
        const storage = new Storage(directory, [...config.localOrigins, ...(config.remoteOrigins ?? [])]);
        await storage.initialize();
        await writeOwner(directory, 'owner', 'long password 123');
        let clock = Date.now();
        const app = createApp(config, { now: () => clock, storage });
        await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve));
        const address = app.address();
        assert.ok(address && typeof address === 'object');
        const port = address.port;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests read arbitrary response bodies
        type Result = { status: number; headers: import('node:http').IncomingHttpHeaders; text: string; json: any };
        const call = (
            path: string,
            method = 'GET',
            data?: unknown,
            extra: Record<string, string> = {}
        ): Promise<Result> =>
            new Promise((resolve, reject) => {
                const serialized = data === undefined ? undefined : JSON.stringify(data);
                const req = request(
                    {
                        host: '127.0.0.1',
                        port,
                        path,
                        method,
                        headers: {
                            Host: 'localhost:8790',
                            ...(serialized
                                ? {
                                      'Content-Type': 'application/json',
                                      'Content-Length': String(Buffer.byteLength(serialized)),
                                  }
                                : {}),
                            ...extra,
                        },
                    },
                    (res) => {
                        const chunks: Buffer[] = [];
                        res.on('data', (chunk) => chunks.push(chunk));
                        res.on('end', () => {
                            const text = Buffer.concat(chunks).toString();
                            let json: unknown;
                            try {
                                json = JSON.parse(text);
                            } catch {
                                /* Static HTML is not JSON. */
                            }
                            resolve({ status: res.statusCode!, headers: res.headers, text, json });
                        });
                    }
                );
                req.on('error', reject);
                req.end(serialized);
            });
        const origin = { Origin: 'http://localhost:8790' };
        try {
            assert.equal((await call('/api/health')).status, 200);
            assert.equal((await call('/api/favorites')).status, 401);
            assert.equal((await call('/api/session')).json.authenticated, false);
            assert.equal((await call('/api/session', 'GET', undefined, { Host: 'evil.example' })).status, 400);
            assert.equal((await call('/api/session', 'GET', undefined, { 'X-Forwarded-Proto': 'https' })).status, 400);
            assert.equal((await call('/api/session', 'GET', undefined, { Host: 'dock.example:8443' })).status, 400);
            assert.equal(
                (await call('/api/login', 'POST', { username: 'owner', password: 'long password 123' })).status,
                403
            );
            assert.equal((await call('/api/login', 'POST', {}, { Origin: 'null' })).status, 403);
            assert.equal(
                (await call('/api/login', 'POST', {}, { ...origin, 'Content-Type': 'text/plain' })).status,
                400
            );
            assert.equal(
                (await call('/api/login', 'POST', { username: 'owner', password: 'wrong' }, origin)).status,
                401
            );
            assert.equal(
                (await call('/api/login', 'POST', { username: 'owner', password: 'long password 123' }, origin)).status,
                429
            );
            clock += 1000;
            const login = await call(
                '/api/login',
                'POST',
                { username: 'owner', password: 'long password 123' },
                origin
            );
            assert.equal(login.status, 200);
            const cookie = login.headers['set-cookie']![0]!;
            assert.match(cookie, /HttpOnly; SameSite=Lax; Max-Age=604800/);
            assert.doesNotMatch(cookie, /Secure|Domain=/);
            const authenticated = { ...origin, Cookie: cookie.split(';')[0]! };
            assert.equal((await call('/api/session', 'GET', undefined, authenticated)).json.authenticated, true);
            const initial = await call('/api/favorites', 'GET', undefined, authenticated);
            assert.equal(initial.headers['cache-control'], 'no-store');
            assert.equal(
                (await call('/api/favorites', 'PUT', { baseRevision: 0, favorites: [favorite] }, authenticated)).status,
                200
            );
            const conflict = await call('/api/favorites', 'PUT', { baseRevision: 0, favorites: [] }, authenticated);
            assert.equal(conflict.status, 409);
            assert.equal(conflict.json.revision, 1);
            assert.deepEqual(conflict.json.favorites, [favorite]);
            assert.equal(
                (
                    await call(
                        '/api/favorites',
                        'PUT',
                        { baseRevision: 1, favorites: [], operation: 'reorder' },
                        authenticated
                    )
                ).status,
                400
            );
            assert.equal(
                (
                    await call(
                        '/api/favorites',
                        'PUT',
                        { baseRevision: 1, favorites: [{ ...favorite, id: 'unknown' }], operation: 'reorder' },
                        authenticated
                    )
                ).status,
                400
            );
            assert.equal(
                (
                    await call(
                        '/api/favorites',
                        'PUT',
                        { baseRevision: 1, favorites: [favorite, favorite], operation: 'reorder' },
                        authenticated
                    )
                ).status,
                400
            );
            assert.equal(
                (
                    await call(
                        '/api/favorites',
                        'PUT',
                        { baseRevision: 1, favorites: [{ ...favorite, name: 'Changed' }], operation: 'reorder' },
                        authenticated
                    )
                ).status,
                400
            );
            assert.equal(
                (
                    await call(
                        '/api/favorites',
                        'PUT',
                        { baseRevision: 1, favorites: [favorite], operation: 'reorder' },
                        authenticated
                    )
                ).status,
                200
            );
            assert.equal(
                (
                    await call(
                        '/api/favorites',
                        'PUT',
                        { baseRevision: 1, favorites: [] },
                        { ...authenticated, Origin: 'http://127.0.0.1:8790' }
                    )
                ).status,
                403
            );
            assert.equal(
                (
                    await call(
                        '/api/favorites',
                        'PUT',
                        { baseRevision: 2, favorites: [favorite], groups: ['Sports', 'sports'] },
                        authenticated
                    )
                ).status,
                400
            );
            assert.equal(
                (
                    await call(
                        '/api/favorites',
                        'PUT',
                        { baseRevision: 2, favorites: [{ ...favorite, group: 'Sports' }], groups: [] },
                        authenticated
                    )
                ).status,
                400
            );
            const grouped = await call(
                '/api/favorites',
                'PUT',
                { baseRevision: 2, favorites: [{ ...favorite, group: 'Sports' }], groups: ['Sports', 'News'] },
                authenticated
            );
            assert.equal(grouped.status, 200);
            assert.deepEqual(grouped.json.groups, ['Sports', 'News']);
            const groupedRead = await call('/api/favorites', 'GET', undefined, authenticated);
            assert.deepEqual(groupedRead.json.favorites, [{ ...favorite, groups: ['Sports'] }]);
            assert.deepEqual(groupedRead.json.groups, ['Sports', 'News']);
            const groupConflict = await call(
                '/api/favorites',
                'PUT',
                { baseRevision: 2, favorites: [], groups: [] },
                authenticated
            );
            assert.equal(groupConflict.status, 409);
            assert.deepEqual(groupConflict.json.groups, ['Sports', 'News']);
            await writeOwner(directory, 'owner', 'new password 456');
            assert.equal((await call('/api/favorites', 'GET', undefined, authenticated)).status, 401);
            const remote = {
                Host: 'dock.example:8443',
                Origin: 'https://dock.example:8443',
                'X-Forwarded-Proto': 'https',
                'X-Forwarded-Host': 'dock.example:8443',
            };
            const remoteLogin = await call(
                '/api/login',
                'POST',
                { username: 'owner', password: 'new password 456' },
                remote
            );
            assert.equal(remoteLogin.status, 200);
            assert.match(remoteLogin.headers['set-cookie']![0]!, /^__Host-sitedock=.*; Secure$/);
            assert.equal(
                (await call('/api/session', 'GET', undefined, { ...remote, 'X-Forwarded-Host': 'evil.example' }))
                    .status,
                400
            );
            const remoteAuth = { ...remote, Cookie: remoteLogin.headers['set-cookie']![0]!.split(';')[0]! };
            clock += 7 * 24 * 60 * 60 * 1000;
            assert.equal((await call('/api/favorites', 'GET', undefined, remoteAuth)).status, 401);
            const relogin = await call(
                '/api/login',
                'POST',
                { username: 'owner', password: 'new password 456' },
                origin
            );
            const logoutAuth = { ...origin, Cookie: relogin.headers['set-cookie']![0]!.split(';')[0]! };
            assert.equal((await call('/api/logout', 'POST', {}, logoutAuth)).status, 200);
            assert.equal((await call('/api/favorites', 'GET', undefined, logoutAuth)).status, 401);
            const page = await call('/');
            assert.match(page.text, /SiteDock/);
            assert.equal(page.headers['x-frame-options'], 'DENY');
            assert.match(String(page.headers['content-security-policy']), /frame-ancestors 'none'/);
            assert.equal(page.headers['cross-origin-resource-policy'], undefined);
            const keys = await call('/sitedock-keys.js');
            assert.equal(keys.status, 200);
            assert.match(String(keys.headers['content-type']), /^text\/javascript/);
            assert.equal(keys.headers['cross-origin-resource-policy'], 'cross-origin');
            const tokens = await call('/sitedock-token.js');
            assert.equal(tokens.status, 200);
            assert.equal(tokens.headers['cross-origin-resource-policy'], 'cross-origin');
            for (const path of ['/owner.json', '/%2e%2e%5cprivate.txt', '/.hidden'])
                assert.notEqual((await call(path)).status, 200);
            await writeFile(join(directory, 'owner.json'), '{broken');
            assert.equal((await call('/api/session')).status, 503);
            assert.equal((await call('/api/favorites', 'GET', undefined, authenticated)).status, 503);
        } finally {
            await new Promise<void>((resolve, reject) => app.close((error) => (error ? reject(error) : resolve())));
        }
    }));

test('gateway authentication relies on the loopback perimeter, accepts exact aliases, and disables duplicate password login', async () =>
    fixture(async (directory) => {
        const config = loadConfig({
            SITEDOCK_DATA_DIR: directory,
            SITEDOCK_AUTH_MODE: 'gateway',
            SITEDOCK_REMOTE_ORIGINS: 'https://dock.example,https://tail.example:8443',
        });
        const storage = new Storage(directory, [...config.localOrigins, ...(config.remoteOrigins ?? [])]);
        await storage.initialize();
        await writeOwner(directory, 'owner', 'long password 123');
        const app = createApp(config, { storage });
        await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve));
        const address = app.address();
        assert.ok(address && typeof address === 'object');
        const port = address.port;
        const call = (path: string, method = 'GET', data?: unknown, extra: Record<string, string> = {}) =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests read arbitrary response bodies
            new Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; json: any }>(
                (resolve, reject) => {
                    const serialized = data === undefined ? undefined : JSON.stringify(data);
                    const req = request(
                        {
                            host: '127.0.0.1',
                            port,
                            path,
                            method,
                            headers: {
                                Host: 'tail.example:8443',
                                'X-Forwarded-Proto': 'https',
                                ...(serialized
                                    ? {
                                          'Content-Type': 'application/json',
                                          'Content-Length': String(Buffer.byteLength(serialized)),
                                      }
                                    : {}),
                                ...extra,
                            },
                        },
                        (res) => {
                            const chunks: Buffer[] = [];
                            res.on('data', (chunk) => chunks.push(chunk));
                            res.on('end', () => {
                                const text = Buffer.concat(chunks).toString();
                                let json: unknown;
                                try {
                                    json = JSON.parse(text);
                                } catch {
                                    /* Ignore non-JSON replies. */
                                }
                                resolve({ status: res.statusCode!, headers: res.headers, json });
                            });
                        }
                    );
                    req.on('error', reject);
                    req.end(serialized);
                }
            );
        try {
            const session = await call('/api/session');
            assert.equal(session.status, 200);
            assert.equal(session.json.authenticated, true);
            assert.equal(session.json.gatewayAuthenticated, true);
            assert.deepEqual(session.json.allowedOrigins, [...config.localOrigins, ...config.remoteOrigins!]);
            assert.equal((await call('/api/favorites')).status, 200);
            assert.equal(
                (
                    await call(
                        '/api/login',
                        'POST',
                        { username: 'owner', password: 'long password 123' },
                        {
                            Origin: 'https://tail.example:8443',
                        }
                    )
                ).status,
                404
            );
            assert.equal(
                (await call('/api/logout', 'POST', {}, { Origin: 'https://tail.example:8443' })).json
                    .gatewayAuthenticated,
                true
            );
            assert.equal((await call('/api/session', 'GET', undefined, { Host: 'evil.example' })).status, 400);
            assert.equal(
                (await call('/api/session', 'GET', undefined, { Host: 'dock.example', 'X-Forwarded-Proto': 'https' }))
                    .json.authenticated,
                true
            );
            assert.equal(
                (
                    await call(
                        '/api/favorites',
                        'PUT',
                        { baseRevision: 0, favorites: [] },
                        {
                            Origin: 'https://tail.example:8443',
                            'X-Forwarded-User': 'untrusted@example.com',
                        }
                    )
                ).status,
                200
            );
        } finally {
            await new Promise<void>((resolve, reject) => app.close((error) => (error ? reject(error) : resolve())));
        }
    }));

test('named groups hold at most 10 sites, with older larger groups kept but unable to grow', async () =>
    fixture(async (directory) => {
        const site = (n: number, groups?: string[]) => ({
            id: `s${n}`,
            name: `Site ${n}`,
            url: `https://s${n}.example.com/`,
            mode: 'embed' as const,
            ...(groups ? { groups } : {}),
        });
        const range = (from: number, to: number, groups?: string[]) =>
            Array.from({ length: to - from + 1 }, (_, i) => site(from + i, groups));
        const storage = new Storage(directory);
        await writeFile(
            join(directory, 'favorites.json'),
            JSON.stringify({
                revision: 1,
                groups: ['Big', 'A', 'B'],
                favorites: [...range(1, 12, ['Big']), ...range(13, 25)],
            })
        );
        // All sites has no limit, and a group of exactly 10 is allowed.
        const ten = await storage.update(
            1,
            [...range(1, 12, ['Big']), ...range(13, 22, ['A']), ...range(23, 25)],
            undefined,
            ['Big', 'A', 'B']
        );
        assert.equal(ten.favorites.length, 25);
        await assert.rejects(
            storage.update(2, [...range(1, 12, ['Big']), ...range(13, 23, ['A']), ...range(24, 25)]),
            /A can hold at most 10 sites/
        );
        // Each group has its own allowance; B can take 10 more even while A is full.
        const both = await storage.update(2, [
            ...range(1, 12, ['Big']),
            ...range(13, 22, ['A']),
            ...range(23, 25, ['B']),
        ]);
        assert.equal(both.revision, 3);
        // The grandfathered group of 12 can be reordered or edited without growing.
        const reordered = [...range(1, 12, ['Big']).reverse(), ...range(13, 22, ['A']), ...range(23, 25, ['B'])];
        assert.equal((await storage.update(3, reordered, 'reorder')).revision, 4);
        const edited = reordered.map((item) => (item.id === 's5' ? { ...item, name: 'Renamed' } : item));
        assert.equal((await storage.update(4, edited)).revision, 5);
        // It can shrink to 11, then cannot grow back to 12.
        const shrunk = edited.map((item) => (item.id === 's1' ? site(1) : item));
        assert.equal((await storage.update(5, shrunk)).revision, 6);
        await assert.rejects(storage.update(6, edited), /Big can hold at most 10 sites/);
        // A new group name inherits no allowance from another group.
        const renamed = shrunk.map((item) => (item.groups?.includes('Big') ? { ...item, groups: ['Huge'] } : item));
        await assert.rejects(
            storage.update(6, renamed, undefined, ['Big', 'A', 'B', 'Huge']),
            /Huge can hold at most 10 sites/
        );
        // Reading the grandfathered file stays valid.
        assert.equal(
            (await new Storage(directory).read()).favorites.filter((item) => item.groups?.includes('Big')).length,
            11
        );
    }));

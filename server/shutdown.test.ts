import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { Server } from 'node:http';
import { test } from 'node:test';
import { installShutdown, stopServer } from './shutdown.js';
import { Storage } from './storage.js';
import { createApp } from './app.js';

test('a private stop request and signals share one awaited shutdown', async () => {
    let requested = false;
    let calls = 0;
    let finish!: () => void;
    let observed!: () => void;
    const started = new Promise<void>((resolve) => {
        observed = resolve;
    });
    const stop = installShutdown(
        async () => {
            calls++;
            observed();
            await new Promise<void>((resolve) => {
                finish = resolve;
            });
        },
        'private\\run\\stop.request',
        (path) => {
            assert.equal(path, 'private\\run\\stop.request');
            return requested;
        }
    );
    try {
        assert.equal(calls, 0);
        requested = true;
        // The watcher is unreferenced in production. Keep this test alive until it fires.
        const keepAlive = setTimeout(() => undefined, 2000);
        try {
            await started;
        } finally {
            clearTimeout(keepAlive);
        }
        let finished = false;
        const pending = stop().then(() => {
            finished = true;
        });
        assert.equal(stop(), stop());
        await Promise.resolve();
        assert.equal(finished, false);
        process.emit('SIGTERM');
        await Promise.resolve();
        assert.equal(calls, 1);
        finish();
        await pending;
        assert.equal(finished, true);
        assert.equal(calls, 1);
    } finally {
        finish?.();
        await stop();
    }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    test(`${signal} runs the same shutdown without a stop file`, async () => {
        let calls = 0;
        const stop = installShutdown(async () => {
            calls++;
        }, '');
        (process as EventEmitter).emit(signal);
        await stop();
        assert.equal(calls, 1);
    });
}

test('storage drain waits for its pending write queue without accessing disk', async () => {
    const storage = new Storage('unused');
    let finish!: () => void;
    (storage as unknown as { queue: Promise<unknown> }).queue = new Promise((resolve) => {
        finish = () => resolve(undefined);
    });
    let drained = false;
    const pending = storage.drain().then(() => {
        drained = true;
    });
    await Promise.resolve();
    assert.equal(drained, false);
    finish();
    await pending;
    assert.equal(drained, true);
});

test('shutdown drains HTTP and storage writes before releasing ownership', async () => {
    const order: string[] = [];
    let close!: () => void;
    let finish!: () => void;
    const server = {
        close(callback: () => void) {
            order.push('close');
            close = callback;
        },
        closeIdleConnections() {
            order.push('closeIdle');
        },
    } as unknown as Pick<Server, 'close' | 'closeIdleConnections'>;
    const pending = stopServer(
        server,
        async () => {
            order.push('drain');
            await new Promise<void>((resolve) => {
                finish = resolve;
            });
        },
        async () => {
            order.push('release');
        }
    );
    assert.deepEqual(order, ['close', 'closeIdle']);
    close();
    await Promise.resolve();
    assert.deepEqual(order, ['close', 'closeIdle', 'drain']);
    finish();
    await pending;
    assert.deepEqual(order, ['close', 'closeIdle', 'drain', 'release']);
});

test('a failed drain retains ownership for recovery', async () => {
    let released = false;
    const server = {
        close(callback: () => void) {
            callback();
        },
        closeIdleConnections() {},
    } as unknown as Pick<Server, 'close' | 'closeIdleConnections'>;
    await assert.rejects(
        stopServer(
            server,
            async () => {
                throw new Error('write failed');
            },
            async () => {
                released = true;
            }
        ),
        /write failed/
    );
    assert.equal(released, false);
});

test('HTTP handler work remains tracked after its socket has gone', async () => {
    const app = createApp({
        port: 8790,
        dataDir: 'unused',
        distDir: 'nonexistent-shutdown-test-static',
        localOrigins: ['http://127.0.0.1:8790'],
    });
    let ended = false;
    app.emit(
        'request',
        {
            rawHeaders: ['host', '127.0.0.1:8790'],
            headers: { host: '127.0.0.1:8790' },
            method: 'GET',
            url: '/',
            destroyed: true,
        },
        {
            setHeader() {},
            writeHead() {},
            end() {
                ended = true;
            },
        }
    );
    let drained = false;
    const pending = app.drainRequests().then(() => {
        drained = true;
    });
    await Promise.resolve();
    assert.equal(drained, false);
    await pending;
    assert.equal(ended, true);
    assert.equal(drained, true);
});

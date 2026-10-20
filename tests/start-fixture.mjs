import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { loadConfig } from '../dist/server/config.js';
import { createApp } from '../dist/server/app.js';
import { Storage, writeOwner } from '../dist/server/storage.js';

const dataDir = await mkdtemp(join(tmpdir(), 'sitedock-browser-test-'));
await writeOwner(dataDir, 'browser-owner', 'browser-test-password-123');
await new Storage(dataDir).initialize();
const config = loadConfig({ SITEDOCK_PORT: '18790', SITEDOCK_DATA_DIR: dataDir });
config.distDir = resolve('frontend', 'dist');
const server = createApp(config);
server.listen(18790, '127.0.0.1');
// Second-origin page that includes the key forwarder, for iframe forwarding tests.
const fixturePage = `<!doctype html><title>Keys Fixture</title><button id="body">Fixture body</button><input id="field" aria-label="Fixture field">
<script src="http://127.0.0.1:18790/sitedock-keys.js"></script>`;
const child = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fixturePage);
});
child.listen(18791, '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => {
        child.close();
        child.closeAllConnections();
        server.close(async () => {
            await rm(dataDir, { recursive: true, force: true });
            process.exit(0);
        });
        server.closeAllConnections();
    });
}

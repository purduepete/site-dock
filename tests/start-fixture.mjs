import { mkdtemp, rm } from 'node:fs/promises';
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
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    server.close(async () => {
      await rm(dataDir, { recursive: true, force: true });
      process.exit(0);
    });
    server.closeAllConnections();
  });
}

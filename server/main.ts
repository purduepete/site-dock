import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { acquireLock, Storage, secureDirectory } from './storage.js';

const config = loadConfig();
await secureDirectory(config.dataDir);
const release = await acquireLock(config.dataDir);
try {
  await new Storage(config.dataDir, [...config.localOrigins, ...(config.remoteOrigin ? [config.remoteOrigin] : [])]).initialize();
  const app = createApp(config);
  app.once('error', async () => { await release(); process.exitCode = 1; });
  app.listen(config.port, '127.0.0.1', () => console.log(`SiteDock listening at http://127.0.0.1:${config.port}`));
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    app.close(() => { void release().finally(() => process.exit()); });
    app.closeIdleConnections();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} catch (error) { await release(); throw error; }

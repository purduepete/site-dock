import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { acquireLock, createStorage, secureDirectory } from './storage.js';
import { installShutdown, stopServer } from './shutdown.js';

const config = loadConfig();
const postgres = process.env.STORAGE_BACKEND === 'postgresql';
if (!postgres) await secureDirectory(config.dataDir);
const release = postgres ? async () => undefined : await acquireLock(config.dataDir);
try {
    const storage = await createStorage(config.dataDir, [
        ...config.localOrigins,
        ...(config.remoteOrigins ?? (config.remoteOrigin ? [config.remoteOrigin] : [])),
    ]);
    await storage.initialize();
    const app = createApp(config, { storage });
    app.once('error', async () => {
        await release();
        process.exitCode = 1;
    });
    app.listen(config.port, '127.0.0.1', () => console.log(`SiteDock listening at http://127.0.0.1:${config.port}`));
    installShutdown(() =>
        stopServer(
            app,
            async () => {
                await app.drainRequests();
                await storage.drain();
                await storage.close?.();
            },
            release
        )
    );
} catch (error) {
    await release();
    throw error;
}

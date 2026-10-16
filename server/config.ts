import { resolve } from 'node:path';

export interface Config {
  port: number;
  dataDir: string;
  distDir: string;
  localOrigins: string[];
  remoteOrigin?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): Config {
  const port = Number(env.SITEDOCK_PORT ?? 8790);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SITEDOCK_PORT must be between 1 and 65535.');
  let remoteOrigin: string | undefined;
  if (env.SITEDOCK_REMOTE_ORIGIN) {
    const url = new URL(env.SITEDOCK_REMOTE_ORIGIN);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('SITEDOCK_REMOTE_ORIGIN must be an HTTPS origin.');
    }
    remoteOrigin = url.origin;
  }
  const localOrigins = [`http://localhost:${port}`, `http://127.0.0.1:${port}`, `http://[::1]:${port}`];
  if (env.SITEDOCK_DEV_ORIGIN) {
    if (env.NODE_ENV !== 'development') throw new Error('SITEDOCK_DEV_ORIGIN requires NODE_ENV=development.');
    const dev = new URL(env.SITEDOCK_DEV_ORIGIN);
    if (dev.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(dev.hostname) ||
        dev.username || dev.password || dev.pathname !== '/' || dev.search || dev.hash) {
      throw new Error('SITEDOCK_DEV_ORIGIN must be a loopback HTTP origin.');
    }
    localOrigins.push(dev.origin);
  }
  return {
    port,
    dataDir: resolve(cwd, env.SITEDOCK_DATA_DIR ?? 'data'),
    distDir: resolve(cwd, 'frontend', 'dist'),
    localOrigins,
    ...(remoteOrigin ? { remoteOrigin } : {}),
  };
}

export const config = loadConfig;

import { resolve } from 'node:path';

export interface Config {
  port: number;
  dataDir: string;
  distDir: string;
  localOrigins: string[];
  remoteOrigins?: string[];
  remoteOrigin?: string;
  authMode?: 'owner' | 'gateway';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): Config {
  const port = Number(env.SITEDOCK_PORT ?? 8790);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SITEDOCK_PORT must be between 1 and 65535.');
  const remoteOrigins = [...new Set([
    ...(env.SITEDOCK_REMOTE_ORIGIN ? [env.SITEDOCK_REMOTE_ORIGIN] : []),
    ...(env.SITEDOCK_REMOTE_ORIGINS ? env.SITEDOCK_REMOTE_ORIGINS.split(',') : []),
  ].map(value => {
    let url: URL;
    try { url = new URL(value.trim()); } catch { throw new Error('SITEDOCK_REMOTE_ORIGINS must contain HTTPS origins.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('SITEDOCK_REMOTE_ORIGINS must contain HTTPS origins.');
    }
    return url.origin;
  }))];
  const authMode = env.SITEDOCK_AUTH_MODE ?? 'owner';
  if (authMode !== 'owner' && authMode !== 'gateway') throw new Error('SITEDOCK_AUTH_MODE must be owner or gateway.');
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
    remoteOrigins,
    ...(remoteOrigins[0] ? { remoteOrigin: remoteOrigins[0] } : {}),
    authMode,
  };
}

export const config = loadConfig;

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { test } from 'node:test';
import { loadConfig } from './config.js';

test('the manifest launches directly with explicit shared paths and a new exact origin', async () => {
  const manifest = JSON.parse(await readFile(resolve('deploy', 'application.json'), 'utf8'));
  assert.equal(manifest.id, 'site-dock');
  assert.equal(manifest.database.name, 'site_dock');
  assert.deepEqual(manifest.managedState, []);
  assert.equal(manifest.launch.environment.STORAGE_BACKEND, 'postgresql');
  assert.equal(manifest.launch.environment.SITEDOCK_AUTH_MODE, 'gateway');
  assert.equal(manifest.launch.environment.DATABASE_URL, undefined);
  assert.deepEqual(manifest.build.excludePaths, ['.env.development']);
  assert.deepEqual(manifest.build.commands, [
    { tool: 'npm', arguments: ['ci'], workingDirectory: '.' },
    { tool: 'npm', arguments: ['run', 'build'], workingDirectory: '.' },
  ]);
  assert.equal(manifest.source.root, 'C:\\Files\\Dev\\main\\site-dock');
  assert.equal(manifest.launch.entrypoint, 'dist\\server\\main.js');
  assert.equal(manifest.launch.secretFile, 'app.env');
  assert.ok(manifest.state.some((item: { source: string; target: string }) =>
    item.source === '.env' && item.target === 'secrets\\source\\app.env'));
  assert.equal(manifest.state.some((item: { target: string }) => item.target === 'secrets\\app.env'), false);
  assert.equal(manifest.launch.stopFileEnvironment, 'SOLUTIONDEPLOY_STOP_FILE');
  assert.equal(manifest.launch.environment.SOLUTIONDEPLOY_STOP_FILE, undefined);
  assert.equal(manifest.launch.environment.SITEDOCK_REMOTE_ORIGIN, undefined);
  assert.equal(manifest.launch.environment.SITEDOCK_REMOTE_ORIGINS,
    'https://site-dock.jimlertech.com,https://jimbrownhome1.tail8ad282.ts.net:8790');
  assert.deepEqual(manifest.source.tasks, ['SiteDock']);
  const environment = {
    ...manifest.launch.environment,
    SITEDOCK_DATA_DIR: resolve('.run', 'manifest-test-data'),
  };
  const config = loadConfig(environment);
  assert.equal(config.port, 8790);
  assert.deepEqual(config.remoteOrigins, [
    'https://site-dock.jimlertech.com',
    'https://jimbrownhome1.tail8ad282.ts.net:8790',
  ]);
  assert.equal(config.dataDir, environment.SITEDOCK_DATA_DIR);
  assert.notEqual(config.dataDir, resolve('data'));
  assert.deepEqual(manifest.readiness.expected, { ok: true });
  for (const item of manifest.state) {
    assert.match(item.target, /^(?:data|secrets|logs|backups)\\/);
    assert.doesNotMatch(item.source, /(?:server|owner)\.(?:lock|pid)|\.pending$/);
  }
  for (const file of ['favorites.json', 'owner.json', 'favorites.json.bak', 'owner.json.bak']) {
    assert.ok(manifest.state.some((item: { source: string; target: string }) =>
      item.source === `data\\${file}` && item.target === `backups\\source\\${file}`));
  }
});

test('tracked development defaults retain the existing exact origin behavior', async () => {
  const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
  assert.match(packageJson.scripts['dev:server'], /--env-file=\.env\.development(?: |$)/);
  const defaults = parseEnv(await readFile(resolve('.env.development'), 'utf8'));
  const config = loadConfig(defaults);
  assert.ok(config.localOrigins.includes('http://127.0.0.1:5173'));
  assert.equal(defaults.NODE_ENV, 'development');
});

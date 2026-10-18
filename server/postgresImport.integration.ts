import assert from 'node:assert/strict';
import { createHash, scryptSync } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { Pool } from 'pg';
import { PostgresStorage } from './postgres.js';
import { verifyPassword } from './storage.js';

const connectionString = process.env.SOLUTIONDEPLOY_PG_TEST_URL;
if (!connectionString) throw new Error('SOLUTIONDEPLOY_PG_TEST_URL is required.');
const target = new URL(connectionString);
if (!['postgres:', 'postgresql:'].includes(target.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) ||
    target.search || decodeURIComponent(target.pathname) !== '/sd_test_sitedock') throw new Error('Require disposable loopback sd_test_sitedock.');
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

test('actual JSON import CLI preserves revision, ordered records and authentication and rejects proof tamper/replay', async () => {
  const root = path.resolve('.run', `pg-import-${process.pid}-${Date.now()}`);
  const data = path.join(root, 'backups', 'source');
  const pool = new Pool({ connectionString, max: 1 });
  try {
    assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, 'sd_test_sitedock');
    assert.deepEqual((await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows, []);
    await pool.query(await readFile(path.resolve('deploy', 'postgresql', '001_initial.sql'), 'utf8'));
    await mkdir(data, { recursive: true });
    const favorites = { revision: 17, groups: ['B', 'A'], favorites: [
      { id: 'b', name: 'B', url: 'https://example.com/b', mode: 'embed', groups: ['B', 'A'] },
      { id: 'a', name: 'A', url: 'https://example.com/a', mode: 'external', groups: ['A'] },
    ] };
    const password = 'synthetic-import-password';
    const salt = 'a'.repeat(32);
    const owner = { username: 'synthetic-owner', salt, hash: scryptSync(password, salt, 64).toString('hex'), version: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' };
    const favoritesBytes = Buffer.from(JSON.stringify(favorites));
    const ownerBytes = Buffer.from(JSON.stringify(owner));
    await writeFile(path.join(data, 'favorites.json'), favoritesBytes);
    await writeFile(path.join(data, 'owner.json'), ownerBytes);
    const proof = Buffer.from(JSON.stringify({
      planHash: 'a'.repeat(64), operationId: 'synthetic-import', sourceHost: 'jimbrownhome',
      stateDeclarationSHA256: 'b'.repeat(64), fence: { stopped: true }, directories: [],
      files: [
        { target: 'backups\\source\\favorites.json', kind: 'file', bytes: favoritesBytes.length, sha256: sha(favoritesBytes) },
        { target: 'backups\\source\\owner.json', kind: 'secret', bytes: ownerBytes.length, sha256: sha(ownerBytes) },
      ],
    }));
    const index = path.join(root, 'transfer.json');
    await writeFile(index, proof);
    const combined = sha(Buffer.concat([favoritesBytes, ownerBytes]));
    const run = (indexHash: string, sourceHash = combined) => new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [
        'deploy\\postgresql\\import.mjs', '--source-dir', root, '--source-index', index,
        '--expected-index-sha256', indexHash, '--expected-source-sha256', sourceHash, '--execute',
      ], { env: { ...process.env, DATABASE_URL: connectionString }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 });
      let output = '';
      child.stdout.on('data', bytes => { output += bytes.toString(); });
      child.stderr.on('data', bytes => { output += bytes.toString(); });
      child.on('error', reject);
      child.on('close', code => resolve({ code, output }));
    });
    assert.notEqual((await run('0'.repeat(64))).code, 0);
    assert.notEqual((await run(sha(proof), '0'.repeat(64))).code, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM public.sitedock_favorites')).rows[0].n, 0);
    const imported = await run(sha(proof));
    assert.equal(imported.code, 0, imported.output);
    const storage = new PostgresStorage(pool);
    await storage.initialize();
    assert.deepEqual(await storage.read(), favorites);
    assert.deepEqual(await storage.readOwner(), owner);
    assert.equal(await verifyPassword(await storage.readOwner(), owner.username, password), true);
    assert.equal(await verifyPassword(await storage.readOwner(), owner.username, 'wrong-password'), false);
    const replay = await run(sha(proof));
    assert.notEqual(replay.code, 0);
    assert.match(replay.output, /not empty/);
    assert.deepEqual(await storage.read(), favorites);
    assert.deepEqual(await storage.readOwner(), owner);
    assert.equal((await pool.query("SELECT source_sha256 FROM public.solutiondeploy_import WHERE app_id='site-dock'")).rows[0].source_sha256, combined);
  } finally { await pool.end(); await rm(root, { recursive: true, force: true }); }
});

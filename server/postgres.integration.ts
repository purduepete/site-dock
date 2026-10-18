import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { Pool } from 'pg';
import { PostgresStorage } from './postgres.js';
import { ConflictError, verifyPassword } from './storage.js';

const connectionString = process.env.SOLUTIONDEPLOY_PG_TEST_URL;
if (!connectionString) throw new Error('SOLUTIONDEPLOY_PG_TEST_URL is required; DATABASE_URL is never used by this suite.');
const target = new URL(connectionString);
if (!['postgres:', 'postgresql:'].includes(target.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) ||
    target.search !== '' ||
    decodeURIComponent(target.pathname) !== '/sd_test_sitedock') {
  throw new Error('Integration tests require the loopback-only sd_test_sitedock disposable database.');
}

test('JSONB revision conflicts, transaction rollback and owner credentials survive PostgreSQL roundtrip', async () => {
  const pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000, options: '-c search_path=pg_catalog,public' });
  try {
    const identity = await pool.query('SELECT current_database() AS name');
    assert.equal(identity.rows[0].name, 'sd_test_sitedock');
    const tables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
    assert.deepEqual(tables.rows, []);
    await pool.query(await readFile(resolve('deploy', 'postgresql', '001_initial.sql'), 'utf8'));
    const initial = {
      revision: 12, groups: ['B', 'A'],
      favorites: [
        { id: 'b', name: 'B', url: 'https://example.com/b', mode: 'embed', groups: ['B', 'A'] },
        { id: 'a', name: 'A', url: 'https://example.com/a', mode: 'external', groups: ['A'] },
      ],
    };
    await pool.query('INSERT INTO public.sitedock_favorites(singleton,document) VALUES(TRUE,$1::jsonb)', [JSON.stringify(initial)]);
    const storage = new PostgresStorage(pool);
    await storage.initialize();
    assert.deepEqual(await storage.read(), initial);
    const first = await storage.update(12, [...initial.favorites].reverse(), 'reorder', initial.groups);
    assert.equal(first.revision, 13);
    assert.deepEqual(first.favorites, [...initial.favorites].reverse());
    await assert.rejects(storage.update(12, initial.favorites), ConflictError);
    assert.deepEqual(await storage.read(), first);
    const raced = await Promise.allSettled([
      storage.update(13, first.favorites), storage.update(13, first.favorites),
    ]);
    assert.equal(raced.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(raced.filter(result => result.status === 'rejected' && result.reason instanceof ConflictError).length, 1);
    const owner = await storage.writeOwner('owner', 'test-only-password-123', { setup: true });
    const read = await storage.readOwner();
    assert.deepEqual(read, owner);
    assert.equal(await verifyPassword(read, 'owner', 'test-only-password-123'), true);
    assert.equal(await verifyPassword(read, 'owner', 'wrong-password'), false);
    const reset = await storage.writeOwner('owner', 'test-only-password-456', { setup: false });
    assert.notEqual(reset.version, owner.version);
    assert.equal(await verifyPassword(await storage.readOwner(), 'owner', 'test-only-password-456'), true);
    await assert.rejects(storage.writeOwner('owner', 'test-only-password-789', { setup: true }), /already exists/);
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN');
      await connection.query("UPDATE public.sitedock_favorites SET document=jsonb_set(document,'{revision}','99') WHERE singleton=TRUE");
      await connection.query('ROLLBACK');
    } finally { connection.release(); }
    assert.equal((await storage.read()).revision, 14);
  } finally { await pool.end(); }
});

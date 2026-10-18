import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { PostgresStorage, validateOwner } from './postgres.js';
import { ConflictError, createStorage } from './storage.js';

const current = { revision: 7, groups: ['News'], favorites: [{ id: 'news', name: 'News', url: 'https://example.com/', mode: 'embed', groups: ['News'] }] };
function fixture(version = 1) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const query = async (sql: string, values?: unknown[]) => {
    calls.push({ sql, values });
    if (sql.includes('solutiondeploy_schema')) return { rows: [{ version }], rowCount: 1 };
    if (sql.startsWith('SELECT document')) return { rows: [{ document: current }], rowCount: 1 };
    return { rows: [], rowCount: sql.startsWith('UPDATE') ? 1 : 0 };
  };
  let released = false;
  const pool = { query, connect: async () => ({ query, release: () => { released = true; } }), end: async () => undefined };
  return { storage: new PostgresStorage(pool as unknown as Pool), calls, released: () => released };
}

test('PostgreSQL startup reads schema and data without DDL', async () => {
  const { storage, calls } = fixture();
  await storage.initialize();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].sql, 'SELECT version FROM public.solutiondeploy_schema WHERE app_id=$1');
  assert.deepEqual(calls[0].values, ['site-dock']);
  assert.ok(calls.every(call => call.sql.startsWith('SELECT')));
});

test('PostgreSQL rejects a wrong schema without initializing files', async () => {
  const { storage } = fixture(2);
  await assert.rejects(storage.initialize(), /schema version/);
});

test('missing PostgreSQL credentials never fall back to file storage', async () => {
  const oldBackend = process.env.STORAGE_BACKEND;
  const oldUrl = process.env.DATABASE_URL;
  process.env.STORAGE_BACKEND = 'postgresql';
  delete process.env.DATABASE_URL;
  try { await assert.rejects(createStorage('must-not-write'), /DATABASE_URL/); }
  finally {
    if (oldBackend === undefined) delete process.env.STORAGE_BACKEND; else process.env.STORAGE_BACKEND = oldBackend;
    if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl;
  }
});

test('JSONB updates lock the row, preserve ordered documents and condition the revision', async () => {
  const { storage, calls, released } = fixture();
  const result = await storage.update(7, current.favorites, undefined, current.groups);
  assert.equal(result.revision, 8);
  assert.deepEqual(result.favorites, current.favorites);
  assert.ok(calls[1].sql.endsWith('FOR UPDATE'));
  assert.match(calls[2].sql, /document->>'revision'/);
  assert.deepEqual(calls[2].values, [JSON.stringify(result), 7]);
  assert.equal(calls.at(-1)?.sql, 'COMMIT');
  assert.equal(released(), true);
});

test('revision conflicts roll back without altering documents', async () => {
  const { storage, calls, released } = fixture();
  await assert.rejects(storage.update(6, current.favorites), ConflictError);
  assert.equal(calls.at(-1)?.sql, 'ROLLBACK');
  assert.equal(calls.some(call => call.sql.startsWith('UPDATE')), false);
  assert.equal(released(), true);
});

test('invalid reorder edits and unknown groups roll back before any write', async () => {
  const { storage, calls } = fixture();
  await assert.rejects(storage.update(7, [{ ...current.favorites[0], name: 'Changed' }], 'reorder'), /cannot edit/);
  await assert.rejects(storage.update(7, [{ ...current.favorites[0], groups: ['Other'] }]), /existing groups/);
  assert.equal(calls.some(call => call.sql.startsWith('UPDATE')), false);
  assert.equal(calls.filter(call => call.sql === 'ROLLBACK').length, 2);
});

test('owner reads preserve credential material and missing owner retains setup behavior', async () => {
  const owner = { username: 'owner', salt: 'a'.repeat(32), hash: 'b'.repeat(128), version: '12345678-1234-1234-1234-123456789012' };
  const storage = new PostgresStorage({ query: async () => ({ rows: [{ document: owner }] }) } as unknown as Pool);
  assert.deepEqual(await storage.readOwner(), owner);
  const missing = new PostgresStorage({ query: async () => ({ rows: [] }) } as unknown as Pool);
  await assert.rejects(missing.readOwner(), { code: 'ENOENT' });
});

test('owner import validation preserves salt hash and version exactly', () => {
  const owner = { username: 'owner', salt: 'a'.repeat(32), hash: 'b'.repeat(128), version: '12345678-1234-1234-1234-123456789012' };
  assert.equal(validateOwner(owner), owner);
  assert.throws(() => validateOwner({ ...owner, hash: 'invalid' }), /invalid/);
});

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';
import { validateFavorites, validateGroups } from '../../dist/server/storage.js';
import { validateOwner } from '../../dist/server/postgres.js';
import { sourceEntry, validateTransferProof, verifySourceBytes } from './source-proof.mjs';
import { postgresConnection } from '../../dist/server/postgresConnection.js';

const argument = name => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const sourceDir = argument('--source-dir');
const expected = argument('--expected-source-sha256');
const sourceIndex = argument('--source-index');
const expectedIndex = argument('--expected-index-sha256');
if (!sourceDir || !/^[a-f0-9]{64}$/i.test(expected ?? '')) throw new Error('Require --source-dir and --expected-source-sha256 (SHA-256 of favorites bytes followed by owner bytes).');
if (!process.argv.includes('--execute')) throw new Error('Require --execute after independent review and production approval.');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be in private environment.');
if (!sourceIndex) throw new Error('Require --source-index pointing to the reviewed transfer.json.');
const proof = validateTransferProof(await readFile(sourceIndex), expectedIndex, 'site-dock');
const favoritesEntry = sourceEntry(proof, 'favorites.json', ['file']);
const ownerEntry = sourceEntry(proof, 'owner.json', ['secret']);
const favoritesBytes = await readFile(path.resolve(sourceDir, ...favoritesEntry.target.split('\\')));
const ownerBytes = await readFile(path.resolve(sourceDir, ...ownerEntry.target.split('\\')));
verifySourceBytes(favoritesEntry, favoritesBytes);
verifySourceBytes(ownerEntry, ownerBytes);
const sourceSha = createHash('sha256').update(favoritesBytes).update(ownerBytes).digest('hex');
if (sourceSha !== expected.toLowerCase()) throw new Error('Source snapshot SHA-256 mismatch.');
const document = JSON.parse(favoritesBytes.toString('utf8'));
if (!Number.isSafeInteger(document.revision) || document.revision < 0) throw new Error('Invalid source revision.');
const favorites = {
  revision: document.revision,
  favorites: validateFavorites(document.favorites),
  groups: validateGroups(document.groups ?? []),
};
if (favorites.favorites.some(f => f.groups?.some(group => !favorites.groups.includes(group)))) throw new Error('Source references an unknown group.');
const owner = validateOwner(JSON.parse(ownerBytes.toString('utf8')));
const pool = new Pool({ ...postgresConnection(process.env.DATABASE_URL), max: 1, connectionTimeoutMillis: 5000, options: '-c search_path=pg_catalog,public' });
let client;
try {
  client = await pool.connect();
  await client.query('BEGIN');
  const ledger = await client.query('SELECT version FROM public.solutiondeploy_schema WHERE app_id=$1', ['site-dock']);
  if (ledger.rows.length !== 1 || ledger.rows[0].version !== 1) throw new Error('Apply reviewed schema version 1 before import.');
  await client.query('LOCK TABLE public.sitedock_favorites, public.sitedock_owner IN ACCESS EXCLUSIVE MODE');
  for (const table of ['sitedock_favorites', 'sitedock_owner']) {
    const result = await client.query(`SELECT COUNT(*)::text AS count FROM public.${table}`);
    if (result.rows[0].count !== '0') throw new Error('Destination is not empty; overwrite and implicit resume are forbidden.');
  }
  await client.query('INSERT INTO public.sitedock_favorites(singleton,document) VALUES(TRUE,$1::jsonb)', [JSON.stringify(favorites)]);
  await client.query('INSERT INTO public.sitedock_owner(singleton,document) VALUES(TRUE,$1::jsonb)', [JSON.stringify(owner)]);
  const parity = await client.query(
    'SELECT (SELECT document=$1::jsonb FROM public.sitedock_favorites WHERE singleton=TRUE) AS favorites, (SELECT document=$2::jsonb FROM public.sitedock_owner WHERE singleton=TRUE) AS owner',
    [JSON.stringify(favorites), JSON.stringify(owner)],
  );
  if (parity.rows[0]?.favorites !== true || parity.rows[0]?.owner !== true) throw new Error('Document parity failed.');
  await client.query('INSERT INTO public.solutiondeploy_import(app_id,source_sha256,validation) VALUES($1,$2,$3::jsonb)', [
    'site-dock', sourceSha, JSON.stringify({ favorites: favorites.favorites.length, groups: favorites.groups.length, revision: favorites.revision, ownerPreserved: true }),
  ]);
  await client.query('COMMIT');
  console.log('SiteDock import committed: favorites/groups order, revision, and owner record preserved. No credential values logged.');
} catch (error) {
  if (client) await client.query('ROLLBACK');
  console.error('Import rolled back. Keep target fenced; preserve failure output. Do not automatically retry.');
  throw error;
} finally { client?.release(); await pool.end(); }

import { constants } from 'node:fs';
import { copyFile, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const scrypt = promisify(scryptCallback);
const exec = promisify(execFile);
export interface Favorite { id: string; name: string; url: string; mode: 'embed' | 'external'; groups?: string[] }
export interface FavoritesStore { revision: number; favorites: Favorite[]; groups: string[] }
export interface Owner { username: string; salt: string; hash: string; version: string }
export class ValidationError extends Error {}
export class ConflictError extends Error {
  constructor(public current: FavoritesStore) { super('Favorites changed. Reconcile your changes and retry.'); }
}

const seeds: Favorite[] = [
  { id: 'ferry-tracker', name: 'Ferry Tracker', url: 'http://100.114.72.86:8787/', mode: 'embed' },
  { id: 'home', name: 'SmartDevices', url: 'https://jimbrownhome.tail8ad282.ts.net:8443/', mode: 'embed' },
  { id: 'fittrack', name: 'FitTrack', url: 'https://fittrack-api.graymoss-46d6bacd.eastus2.azurecontainerapps.io/', mode: 'embed' },
  { id: 'espn', name: 'ESPN', url: 'https://www.espn.com/', mode: 'external' },
];

export function validateGroups(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 50) throw new ValidationError('Groups must be a list of at most 50 names.');
  const seen = new Set<string>();
  return value.map((name: unknown) => {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 50) throw new ValidationError('Group names must contain 1 to 50 characters.');
    const normalized = name.trim();
    if (seen.has(normalized.toLowerCase())) throw new ValidationError('Group names must be unique.');
    seen.add(normalized.toLowerCase());
    return normalized;
  });
}

export function validateFavorites(value: unknown, forbiddenOrigins: readonly string[] = []): Favorite[] {
  if (!Array.isArray(value) || value.length > 200) throw new ValidationError('Favorites must be a list of at most 200 entries.');
  const ids = new Set<string>();
  return value.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new ValidationError('Invalid favorite.');
    const f = item as Record<string, unknown>;
    if (typeof f.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(f.id) || ids.has(f.id)) throw new ValidationError('Favorite IDs must be unique and use letters, digits, underscores or hyphens.');
    ids.add(f.id);
    if (typeof f.name !== 'string' || !f.name.trim() || f.name.length > 120) throw new ValidationError('Names must contain 1 to 120 characters.');
    if (typeof f.url !== 'string' || f.url.length > 4096) throw new ValidationError('URLs must contain at most 4096 characters.');
    let url: URL;
    try { url = new URL(f.url); } catch { throw new ValidationError('Invalid favorite URL.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || forbiddenOrigins.includes(url.origin)) throw new ValidationError('Use a cross-origin HTTP(S) URL without credentials.');
    if (f.mode !== 'embed' && f.mode !== 'external') throw new ValidationError('Invalid display mode.');
    if (f.group !== undefined && (typeof f.group !== 'string' || !f.group.trim() || f.group.trim().length > 50)) throw new ValidationError('Invalid favorite group.');
    if (f.group !== undefined && f.groups !== undefined) throw new ValidationError('Use groups or the legacy group field, not both.');
    const groups = validateGroups(f.groups === undefined ? (typeof f.group === 'string' ? [f.group] : []) : f.groups);
    return { id: f.id, name: f.name.trim(), url: url.href, mode: f.mode, ...(groups.length ? { groups } : {}) };
  });
}

export function validateReorder(current: readonly Favorite[], ids: unknown): string[] {
  if (!Array.isArray(ids) || ids.length !== current.length || new Set(ids).size !== ids.length ||
      ids.some(id => typeof id !== 'string' || !current.some(f => f.id === id))) {
    throw new ValidationError('Reordering requires every current favorite ID exactly once.');
  }
  return ids as string[];
}

function code(error: unknown): string | undefined { return (error as NodeJS.ErrnoException).code; }
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function retry(action: () => Promise<unknown>): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { await action(); return; } catch (error) {
      if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(code(error) ?? '')) throw error;
      await pause(25 * 2 ** attempt);
    }
  }
}

export async function secureDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') {
    // Remove inherited access before any credential record is written.
    const { stdout } = await exec('whoami.exe', []);
    await exec('icacls.exe', [directory, '/inheritance:r', '/grant:r', `${stdout.trim()}:(OI)(CI)F`]);
  }
}

export async function atomicWrite(file: string, value: unknown): Promise<void> {
  const temp = `${file}.${randomUUID()}.pending`;
  try {
    const handle = await open(temp, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); }
    try {
      const old = await readFile(file, 'utf8');
      JSON.parse(old);
      const backupTemp = `${temp}.bak`;
      try { await copyFile(file, backupTemp, constants.COPYFILE_EXCL); await retry(() => rename(backupTemp, `${file}.bak`)); }
      finally { await unlink(backupTemp).catch(() => undefined); }
    } catch (error) { if (code(error) !== 'ENOENT') throw error; }
    await retry(() => rename(temp, file));
  } finally { await unlink(temp).catch(() => undefined); }
}

export async function acquireLock(directory: string, name = 'server.lock'): Promise<() => Promise<void>> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, name);
  let handle;
  try { handle = await open(path, 'wx', 0o600); }
  catch (error) {
    if (code(error) === 'EEXIST') throw new Error(`${name} exists. Another writer may be running. If it crashed, verify its PID and remove this lock manually.`);
    throw error;
  }
  try { await handle.writeFile(`${process.pid}\n`); await handle.sync(); }
  catch (error) { await handle.close(); await unlink(path); throw error; }
  return async () => { await handle.close(); await unlink(path); };
}

export class Storage {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(public directory: string, private forbiddenOrigins: string[] = []) {}
  async initialize(): Promise<void> {
    await secureDirectory(this.directory);
    try { await this.read(); }
    catch (error) {
      if (code(error) !== 'ENOENT') throw error;
      await atomicWrite(join(this.directory, 'favorites.json'), { revision: 0, favorites: seeds });
    }
  }
  async read(): Promise<FavoritesStore> {
    const record = JSON.parse(await readFile(join(this.directory, 'favorites.json'), 'utf8')) as FavoritesStore;
    if (!Number.isSafeInteger(record.revision) || record.revision < 0) throw new Error('Invalid favorites revision. Restore the last good backup.');
    const groups = validateGroups(record.groups === undefined ? [] : record.groups);
    const favorites = validateFavorites(record.favorites, this.forbiddenOrigins);
    if (favorites.some(favorite => favorite.groups?.some(group => !groups.includes(group)))) throw new ValidationError('A favorite references an unknown group.');
    return { revision: record.revision, favorites, groups };
  }
  update(baseRevision: unknown, favorites: unknown, operation?: unknown, groupNames?: unknown): Promise<FavoritesStore> {
    const task = this.queue.then(async () => {
      if (!Number.isSafeInteger(baseRevision) || (baseRevision as number) < 0) throw new ValidationError('A valid baseRevision is required.');
      const validated = validateFavorites(favorites, this.forbiddenOrigins);
      const current = await this.read();
      if (baseRevision !== current.revision) throw new ConflictError(current);
      const groups = groupNames === undefined ? current.groups : validateGroups(groupNames);
      if (validated.some(favorite => favorite.groups?.some(group => !groups.includes(group)))) throw new ValidationError('Choose existing groups for every favorite.');
      if (operation !== undefined && operation !== 'reorder') throw new ValidationError('Invalid favorites operation.');
      if (operation === 'reorder') {
        validateReorder(current.favorites, validated.map(f => f.id));
        if (validated.some(f => {
          const old = current.favorites.find(item => item.id === f.id)!;
          return old.name !== f.name || old.url !== f.url || old.mode !== f.mode ||
            (old.groups?.length ?? 0) !== (f.groups?.length ?? 0) || f.groups?.some(group => !old.groups?.includes(group));
        })) throw new ValidationError('Reordering cannot edit favorite fields.');
        if (JSON.stringify(groups) !== JSON.stringify(current.groups)) throw new ValidationError('Reordering cannot edit groups.');
      }
      if (current.revision === Number.MAX_SAFE_INTEGER) throw new Error('Favorites revision exhausted.');
      const next = { revision: current.revision + 1, favorites: validated, groups };
      await atomicWrite(join(this.directory, 'favorites.json'), next);
      return next;
    });
    this.queue = task.catch(() => undefined);
    return task;
  }
}

export async function readOwner(directory: string): Promise<Owner> {
  const owner = JSON.parse(await readFile(join(directory, 'owner.json'), 'utf8')) as Owner;
  if (typeof owner.username !== 'string' || !owner.username.trim() || owner.username.length > 80 ||
      !/^[0-9a-f]{32}$/.test(owner.salt) || !/^[0-9a-f]{128}$/.test(owner.hash) || !/^[0-9a-f-]{36}$/.test(owner.version)) {
    throw new Error('Owner record is invalid.');
  }
  return owner;
}

export async function writeOwner(directory: string, username: string, password: string, options: { setup?: boolean } = {}): Promise<Owner> {
  if (!username.trim() || username.length > 80 || /[\r\n\0]/.test(username)) throw new ValidationError('Username must contain 1 to 80 characters.');
  if (password.length < 12 || password.length > 1024) throw new ValidationError('Password must contain 12 to 1024 characters.');
  await secureDirectory(directory);
  const release = await acquireLock(directory, 'owner.lock');
  try {
    if (options.setup) {
      try { await readFile(join(directory, 'owner.json')); }
      catch (error) {
        if (code(error) !== 'ENOENT') throw error;
        return await save();
      }
      throw new Error('Owner already exists. Use reset.');
    }
    return await save();
  } finally { await release(); }
  async function save(): Promise<Owner> {
    const salt = randomBytes(16).toString('hex');
    const owner: Owner = { username: username.trim(), salt, hash: (await scrypt(password, salt, 64) as Buffer).toString('hex'), version: randomUUID() };
    await atomicWrite(join(directory, 'owner.json'), owner);
    return owner;
  }
}

export async function verifyPassword(owner: Owner, username: string, password: string): Promise<boolean> {
  const hash = await scrypt(password, owner.salt, 64) as Buffer;
  return timingSafeEqual(hash, Buffer.from(owner.hash, 'hex')) && owner.username === username;
}

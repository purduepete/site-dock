import { randomBytes, randomUUID, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { postgresConnection } from './postgresConnection.js';
import {
    ConflictError,
    ValidationError,
    validateFavorites,
    validateGroups,
    validateGroupCap,
    validateReorder,
    preserveFavoriteHiddenState,
    type FavoritesStore,
    type Owner,
    type StorageBackend,
} from './storage.js';

const scrypt = promisify(scryptCallback);

export class PostgresStorage implements StorageBackend {
    constructor(
        readonly pool: Pool,
        private forbiddenOrigins: string[] = []
    ) {}
    async initialize(): Promise<void> {
        const result = await this.pool.query('SELECT version FROM public.solutiondeploy_schema WHERE app_id=$1', [
            'site-dock',
        ]);
        if (result.rows.length !== 1 || result.rows[0].version !== 1)
            throw new Error('SiteDock PostgreSQL schema version mismatch.');
        await this.read();
    }
    async ready(): Promise<void> {
        await this.pool.query('SELECT 1');
    }
    async read(): Promise<FavoritesStore> {
        const result = await this.pool.query('SELECT document FROM public.sitedock_favorites WHERE singleton=TRUE');
        if (result.rows.length !== 1) throw new Error('SiteDock favorites have not been imported.');
        return this.validate(result.rows[0].document);
    }
    private validate(value: FavoritesStore): FavoritesStore {
        if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0)
            throw new Error('Invalid favorites revision.');
        const groups = validateGroups(value.groups ?? []);
        const hiddenGroups = validateGroups(value.hiddenGroups ?? []);
        const favorites = validateFavorites(value.favorites, this.forbiddenOrigins);
        if (favorites.some((f) => f.groups?.some((group) => !groups.includes(group))))
            throw new ValidationError('A favorite references an unknown group.');
        if (hiddenGroups.some((group) => !groups.includes(group)))
            throw new ValidationError('A hidden group must exist in the group list.');
        return { revision: value.revision, favorites, groups, hiddenGroups };
    }
    async update(
        baseRevision: unknown,
        favorites: unknown,
        operation?: unknown,
        groupNames?: unknown,
        hiddenGroupNames?: unknown
    ): Promise<FavoritesStore> {
        if (!Number.isSafeInteger(baseRevision) || (baseRevision as number) < 0)
            throw new ValidationError('A valid baseRevision is required.');
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await client.query(
                'SELECT document FROM public.sitedock_favorites WHERE singleton=TRUE FOR UPDATE'
            );
            if (result.rows.length !== 1) throw new Error('SiteDock favorites have not been imported.');
            const current = this.validate(result.rows[0].document);
            if (current.revision !== baseRevision) throw new ConflictError(current);
            const validated = preserveFavoriteHiddenState(
                validateFavorites(favorites, this.forbiddenOrigins),
                current.favorites
            );
            const groups = groupNames === undefined ? current.groups : validateGroups(groupNames);
            const hiddenGroups =
                hiddenGroupNames === undefined ? current.hiddenGroups : validateGroups(hiddenGroupNames);
            if (validated.some((f) => f.groups?.some((group) => !groups.includes(group))))
                throw new ValidationError('Choose existing groups for every favorite.');
            if (hiddenGroups.some((group) => !groups.includes(group)))
                throw new ValidationError('A hidden group must exist in the group list.');
            validateGroupCap(validated, current.favorites);
            if (operation !== undefined && operation !== 'reorder')
                throw new ValidationError('Invalid favorites operation.');
            if (operation === 'reorder') {
                validateReorder(
                    current.favorites,
                    validated.map((f) => f.id)
                );
                if (
                    validated.some((f) => {
                        const old = current.favorites.find((item) => item.id === f.id)!;
                        return (
                            old.name !== f.name ||
                            old.url !== f.url ||
                            old.mode !== f.mode ||
                            old.hidden !== f.hidden ||
                            (old.groups?.length ?? 0) !== (f.groups?.length ?? 0) ||
                            f.groups?.some((group) => !old.groups?.includes(group))
                        );
                    })
                )
                    throw new ValidationError('Reordering cannot edit favorite fields.');
                if (JSON.stringify(groups) !== JSON.stringify(current.groups))
                    throw new ValidationError('Reordering cannot edit groups.');
                if (JSON.stringify(hiddenGroups) !== JSON.stringify(current.hiddenGroups))
                    throw new ValidationError('Reordering cannot edit hidden groups.');
            }
            if (current.revision === Number.MAX_SAFE_INTEGER) throw new Error('Favorites revision exhausted.');
            const next = { revision: current.revision + 1, favorites: validated, groups, hiddenGroups };
            const updated = await client.query(
                "UPDATE public.sitedock_favorites SET document=$1::jsonb WHERE singleton=TRUE AND (document->>'revision')::bigint=$2",
                [JSON.stringify(next), baseRevision]
            );
            if (updated.rowCount !== 1) throw new ConflictError(current);
            await client.query('COMMIT');
            return next;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
    async readOwner(): Promise<Owner> {
        const result = await this.pool.query('SELECT document FROM public.sitedock_owner WHERE singleton=TRUE');
        if (result.rows.length === 0) {
            const error = new Error('Owner setup is required.');
            Object.assign(error, { code: 'ENOENT' });
            throw error;
        }
        return validateOwner(result.rows[0].document);
    }
    async writeOwner(username: string, password: string, options: { setup?: boolean }): Promise<Owner> {
        const salt = randomBytes(16).toString('hex');
        const owner: Owner = {
            username: username.trim(),
            salt,
            hash: ((await scrypt(password, salt, 64)) as Buffer).toString('hex'),
            version: randomUUID(),
        };
        const result = options.setup
            ? await this.pool.query(
                  'INSERT INTO public.sitedock_owner(singleton, document) VALUES(TRUE,$1::jsonb) ON CONFLICT DO NOTHING',
                  [JSON.stringify(owner)]
              )
            : await this.pool.query('UPDATE public.sitedock_owner SET document=$1::jsonb WHERE singleton=TRUE', [
                  JSON.stringify(owner),
              ]);
        if (result.rowCount !== 1)
            throw new Error(options.setup ? 'Owner already exists. Use reset.' : 'Owner does not exist. Use setup.');
        return owner;
    }
    async drain(): Promise<void> {
        /* HTTP handlers are drained before the pool closes. */
    }
    async close(): Promise<void> {
        await this.pool.end();
    }
}

export function validateOwner(owner: Owner): Owner {
    if (
        !owner ||
        typeof owner.username !== 'string' ||
        !owner.username.trim() ||
        owner.username.length > 80 ||
        !/^[0-9a-f]{32}$/.test(owner.salt) ||
        !/^[0-9a-f]{128}$/.test(owner.hash) ||
        !/^[0-9a-f-]{36}$/.test(owner.version)
    ) {
        throw new Error('Owner record is invalid.');
    }
    return owner;
}

let storage: Promise<PostgresStorage> | undefined;
export function getPostgresStorage(forbiddenOrigins: string[] = []): Promise<PostgresStorage> {
    if (!storage) {
        storage = (async () => {
            if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for PostgreSQL storage.');
            const pool = new Pool({
                ...postgresConnection(process.env.DATABASE_URL),
                max: 5,
                connectionTimeoutMillis: 5000,
                options: '-c search_path=pg_catalog,public',
            });
            const result = new PostgresStorage(pool, forbiddenOrigins);
            try {
                await result.initialize();
                return result;
            } catch (error) {
                await pool.end();
                throw error;
            }
        })();
    }
    return storage;
}

export async function closePostgresStorage(): Promise<void> {
    if (storage) await (await storage).close();
}

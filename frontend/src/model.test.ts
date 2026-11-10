import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    api,
    ApiError,
    clampWidth,
    GROUP_LIMIT,
    groupCapViolation,
    isExternal,
    isHiddenFavorite,
    moveFavorite,
    shortcutKey,
    validateUrl,
    type Favorite,
} from './model';

const item: Favorite = { id: 'one', name: 'One', url: 'https://example.com/', mode: 'embed' };
afterEach(() => vi.unstubAllGlobals());

describe('favorite addresses and display modes', () => {
    it('hides a favorite that is explicitly hidden or belongs to any hidden group', () => {
        expect(isHiddenFavorite(item, [])).toBe(false);
        expect(isHiddenFavorite({ ...item, hidden: true }, [])).toBe(true);
        expect(isHiddenFavorite({ ...item, groups: ['A', 'B'] }, ['B'])).toBe(true);
        expect(isHiddenFavorite({ ...item, groups: ['A', 'B'], hidden: true }, ['B'])).toBe(true);
    });
    it('accepts cross-origin HTTP(S) and normalizes the saved address', () => {
        expect(validateUrl(' https://example.com ')).toBe('https://example.com/');
        expect(validateUrl('http://example.com')).toBe('http://example.com/');
    });
    it.each([
        'javascript:alert(1)',
        'data:text/html,test',
        'file:///test',
        'https://user:secret@example.com/',
        'bad address',
        'https://dock.test/',
    ])('rejects unsafe or recursive address %s', (value) => {
        expect(() => validateUrl(value, ['https://dock.test'])).toThrow();
    });
    it('forces HTTP favorites into external mode under HTTPS without changing the preference', () => {
        const favorite = { ...item, url: 'http://example.com/' };
        expect(isExternal(favorite, 'https:')).toBe(true);
        expect(isExternal(favorite, 'http:')).toBe(false);
        expect(favorite.mode).toBe('embed');
        expect(isExternal({ ...item, mode: 'external' }, 'http:')).toBe(true);
    });
});

describe('layout and ordering', () => {
    it('moves a favorite while preserving every record exactly once', () => {
        const list = [item, { ...item, id: 'two' }, { ...item, id: 'three' }];
        expect(moveFavorite(list, 'one', 2).map((value) => value.id)).toEqual(['two', 'three', 'one']);
        expect(list[0].id).toBe('one');
        expect(moveFavorite(list, 'missing', 0)).toBe(list);
        expect(moveFavorite(list, 'one', -1)).toBe(list);
    });
    it('bounds stored and keyboard widths', () => {
        expect(clampWidth(NaN)).toBe(280);
        expect(clampWidth(100)).toBe(220);
        expect(clampWidth(900)).toBe(480);
    });
});

describe('same-origin JSON requests', () => {
    it('sends full-list mutations with credentials and preserves conflict data', async () => {
        const store = { revision: 3, favorites: [item] };
        const fetch = vi
            .fn()
            .mockResolvedValue(new Response(JSON.stringify({ ...store, error: 'Conflict' }), { status: 409 }));
        vi.stubGlobal('fetch', fetch);
        await expect(api('favorites', { baseRevision: 2, favorites: [] })).rejects.toMatchObject({
            status: 409,
            store,
        });
        expect(fetch).toHaveBeenCalledWith(
            '/api/favorites',
            expect.objectContaining({
                method: 'PUT',
                credentials: 'same-origin',
                cache: 'no-store',
                headers: { 'Content-Type': 'application/json' },
            })
        );
    });
    it('reports a non-JSON failure as an API error', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Oops', { status: 500 })));
        await expect(api('session')).rejects.toBeInstanceOf(ApiError);
    });
});

describe('shortcut keys and the group limit', () => {
    const site = (id: string, groups?: string[]): Favorite => ({ ...item, id, ...(groups ? { groups } : {}) });
    const many = (count: number, groups?: string[]) => Array.from({ length: count }, (_, i) => site(`s${i}`, groups));
    it('maps the first 10 positions to 1-9 then 0', () => {
        expect(Array.from({ length: 11 }, (_, i) => shortcutKey(i))).toEqual([
            '1',
            '2',
            '3',
            '4',
            '5',
            '6',
            '7',
            '8',
            '9',
            '0',
            null,
        ]);
        expect(shortcutKey(-1)).toBeNull();
    });
    it('allows 10 per group, keeps older larger groups, and blocks growth', () => {
        expect(GROUP_LIMIT).toBe(10);
        expect(groupCapViolation(many(10, ['G']), [])).toBeNull();
        expect(groupCapViolation(many(11, ['G']), many(10, ['G']))).toBe('G');
        expect(groupCapViolation(many(12, ['G']), many(12, ['G']))).toBeNull();
        expect(groupCapViolation(many(11, ['G']), many(12, ['G']))).toBeNull();
        expect(groupCapViolation(many(13, ['G']), many(12, ['G']))).toBe('G');
        expect(groupCapViolation(many(30), [])).toBeNull();
        expect(groupCapViolation(many(11, ['New']), many(12, ['Old']))).toBe('New');
    });
});

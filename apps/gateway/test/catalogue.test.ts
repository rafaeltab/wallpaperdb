import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { setup, wallpaper } from './helpers/catalogue.js';
describe('Catalogue capability', () => {
  it('returns an empty default page', async () => {
    const { read, catalogue } = setup();
    expect(await Effect.runPromise(catalogue.search({}))).toEqual({
      _tag: 'Found',
      value: {
        wallpapers: [],
        pageInfo: {
          hasNextPage: false,
          hasPreviousPage: false,
          startCursor: null,
          endCursor: null,
        },
      },
    });
    expect(read.selections).toEqual([{ size: 11, sortOrder: 'asc' }]);
  });
  it('selects an extra result and signs only displayed forward page boundaries', async () => {
    const { read, catalogue, cursors } = setup();
    read.response = {
      _tag: 'Found',
      value: {
        entries: ['a', 'b', 'c'].map((id) => ({ wallpaper: wallpaper(id), cursor: [id] })),
        total: 3,
      },
    };
    const result = await Effect.runPromise(
      catalogue.search({ first: 2, profileId: 'profile_one', variants: { width: 1920 } })
    );
    expect(result).toEqual({
      _tag: 'Found',
      value: {
        wallpapers: [wallpaper('a'), wallpaper('b')],
        pageInfo: {
          hasNextPage: true,
          hasPreviousPage: false,
          startCursor: '["a"]',
          endCursor: '["b"]',
        },
      },
    });
    expect(read.selections).toEqual([
      { size: 3, sortOrder: 'asc', profileId: 'profile_one', variantFilters: { width: 1920 } },
    ]);
    expect(cursors.values.size).toBe(2);
  });
  it('resumes a forward page at the signed position', async () => {
    const { read, catalogue, cursors } = setup();
    const after = await Effect.runPromise(cursors.encode(['a']));
    const result = await Effect.runPromise(catalogue.search({ first: 2, after }));
    expect(read.selections[0]).toMatchObject({ searchAfter: ['a'], sortOrder: 'asc' });
    expect(result).toMatchObject({ value: { pageInfo: { hasPreviousPage: true } } });
  });
  it('reverses backward results and preserves cursors and page flags', async () => {
    const { read, catalogue, cursors } = setup();
    const before = await Effect.runPromise(cursors.encode(['d']));
    read.response = {
      _tag: 'Found',
      value: {
        entries: ['c', 'b', 'a'].map((id) => ({ wallpaper: wallpaper(id), cursor: [id] })),
        total: 4,
      },
    };
    expect(await Effect.runPromise(catalogue.search({ last: 2, before }))).toEqual({
      _tag: 'Found',
      value: {
        wallpapers: [wallpaper('b'), wallpaper('c')],
        pageInfo: {
          hasNextPage: true,
          hasPreviousPage: true,
          startCursor: '["b"]',
          endCursor: '["c"]',
        },
      },
    });
    expect(read.selections[0]).toMatchObject({ searchAfter: ['d'], sortOrder: 'desc', size: 3 });
  });
  it('preserves the legacy last-without-before behavior', async () => {
    const { read, catalogue } = setup();
    await Effect.runPromise(catalogue.search({ last: 2 }));
    expect(read.selections[0]).toMatchObject({ size: 3, sortOrder: 'asc' });
  });
  it('does not claim a following page when a backward search is empty', async () => {
    const { catalogue, cursors } = setup();
    const before = await Effect.runPromise(cursors.encode(['a']));
    expect(await Effect.runPromise(catalogue.search({ last: 2, before }))).toMatchObject({
      value: { pageInfo: { hasNextPage: false, hasPreviousPage: false } },
    });
  });
  it('rejects invalid cursors before reading the catalogue', async () => {
    const { read, catalogue } = setup();
    expect(await Effect.runPromise(catalogue.search({ after: 'tampered' }))).toEqual({
      _tag: 'InvalidCursor',
    });
    expect(read.selections).toEqual([]);
  });
  it('preserves unavailable outcomes', async () => {
    const { read, catalogue } = setup();
    read.response = { _tag: 'Unavailable' };
    read.unavailable = true;
    expect(await Effect.runPromise(catalogue.search({}))).toEqual({ _tag: 'Unavailable' });
    expect(await Effect.runPromise(catalogue.wallpaper('wlpr_a'))).toEqual({ _tag: 'Unavailable' });
    expect(await Effect.runPromise(catalogue.profile('p'))).toEqual({ _tag: 'Unavailable' });
    expect(await Effect.runPromise(catalogue.profileByHandle('h'))).toEqual({
      _tag: 'Unavailable',
    });
    expect(await Effect.runPromise(catalogue.profiles(['p']))).toEqual({ _tag: 'Unavailable' });
  });
  it('reads wallpapers and missing public records', async () => {
    const { read, catalogue } = setup();
    read.wallpapers.set('wlpr_a', wallpaper('wlpr_a'));
    expect(await Effect.runPromise(catalogue.wallpaper('wlpr_a'))).toEqual({
      _tag: 'Found',
      value: wallpaper('wlpr_a'),
    });
    expect(await Effect.runPromise(catalogue.wallpaper('wlpr_missing'))).toEqual({
      _tag: 'Found',
      value: null,
    });
    expect(await Effect.runPromise(catalogue.profile('p'))).toEqual({ _tag: 'Found', value: null });
    expect(await Effect.runPromise(catalogue.profileByHandle('h'))).toEqual({
      _tag: 'Found',
      value: null,
    });
    expect(await Effect.runPromise(catalogue.profiles(['p', 'p']))).toEqual({
      _tag: 'Found',
      value: [null, null],
    });
  });
  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rejects invalid page size %s without reading', async (first) => {
    const { read, catalogue } = setup();
    expect(await Effect.runPromise(catalogue.search({ first }))).toMatchObject({
      _tag: 'InvalidSearch',
    });
    expect(read.selections).toEqual([]);
  });
  it('resolves case-insensitive Handles and preserves Profile batch order and duplicate slots', async () => {
    const { read, catalogue } = setup();
    const profile = {
      id: 'p',
      handle: 'artist',
      displayName: 'Artist',
      biographyMarkdown: 'Bio',
      pictureAssetId: null,
      version: 2,
      claimGeneration: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    read.profileSnapshots.set('p', profile);
    expect(await Effect.runPromise(catalogue.profile('p'))).toEqual({
      _tag: 'Found',
      value: profile,
    });
    expect(await Effect.runPromise(catalogue.profileByHandle('ARTIST'))).toEqual({
      _tag: 'Found',
      value: profile,
    });
    expect(await Effect.runPromise(catalogue.profiles(['p', 'missing', 'p']))).toEqual({
      _tag: 'Found',
      value: [profile, null, profile],
    });
    expect(await Effect.runPromise(catalogue.profiles([]))).toEqual({ _tag: 'Found', value: [] });
  });
  it('returns a backward boundary page without claiming earlier results', async () => {
    const { catalogue, read, cursors } = setup();
    const before = await Effect.runPromise(cursors.encode(['b']));
    read.response = {
      _tag: 'Found',
      value: { entries: [{ wallpaper: wallpaper('a'), cursor: ['a'] }], total: 2 },
    };
    expect(await Effect.runPromise(catalogue.search({ last: 2, before }))).toMatchObject({
      value: { pageInfo: { hasNextPage: true, hasPreviousPage: false } },
    });
  });
});

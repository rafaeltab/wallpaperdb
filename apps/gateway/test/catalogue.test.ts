import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { setup, wallpaper } from './helpers/catalogue.js';
describe('Catalogue capability', () => {
  it('returns an empty default page', async () => {
    const { read, catalogue } = await setup();
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
    const { read, catalogue, cursors } = await setup();
    read.response = {
      entries: ['a', 'b', 'c'].map((id) => ({ wallpaper: wallpaper(id), cursor: [id] })),
      total: 3,
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
          startCursor: expect.any(String),
          endCursor: expect.any(String),
        },
      },
    });
    expect(read.selections).toEqual([
      { size: 3, sortOrder: 'asc', profileId: 'profile_one', variantFilters: { width: 1920 } },
    ]);
    expect(cursors.values.size).toBe(2);
    if (result._tag !== 'Found') throw new Error('Expected a catalogue page');
    expect(
      await Effect.runPromise(cursors.decode(result.value.pageInfo.startCursor ?? ''))
    ).toEqual({
      _tag: 'Decoded',
      values: ['a'],
    });
    expect(await Effect.runPromise(cursors.decode(result.value.pageInfo.endCursor ?? ''))).toEqual({
      _tag: 'Decoded',
      values: ['b'],
    });
  });
  it('resumes a forward page at the signed position', async () => {
    const { read, catalogue, cursors } = await setup();
    const after = await Effect.runPromise(cursors.encode(['a']));
    const result = await Effect.runPromise(catalogue.search({ first: 2, after }));
    expect(read.selections[0]).toMatchObject({ searchAfter: ['a'], sortOrder: 'asc' });
    expect(result).toMatchObject({ value: { pageInfo: { hasPreviousPage: true } } });
  });
  it('reverses backward results and preserves cursors and page flags', async () => {
    const { read, catalogue, cursors } = await setup();
    const before = await Effect.runPromise(cursors.encode(['d']));
    read.response = {
      entries: ['c', 'b', 'a'].map((id) => ({ wallpaper: wallpaper(id), cursor: [id] })),
      total: 4,
    };
    const result = await Effect.runPromise(catalogue.search({ last: 2, before }));
    expect(result).toEqual({
      _tag: 'Found',
      value: {
        wallpapers: [wallpaper('b'), wallpaper('c')],
        pageInfo: {
          hasNextPage: true,
          hasPreviousPage: true,
          startCursor: expect.any(String),
          endCursor: expect.any(String),
        },
      },
    });
    expect(read.selections[0]).toMatchObject({ searchAfter: ['d'], sortOrder: 'desc', size: 3 });
    if (result._tag !== 'Found') throw new Error('Expected a catalogue page');
    expect(
      await Effect.runPromise(cursors.decode(result.value.pageInfo.startCursor ?? ''))
    ).toEqual({
      _tag: 'Decoded',
      values: ['b'],
    });
    expect(await Effect.runPromise(cursors.decode(result.value.pageInfo.endCursor ?? ''))).toEqual({
      _tag: 'Decoded',
      values: ['c'],
    });
  });
  it('preserves the legacy last-without-before behavior', async () => {
    const { read, catalogue } = await setup();
    await Effect.runPromise(catalogue.search({ last: 2 }));
    expect(read.selections[0]).toMatchObject({ size: 3, sortOrder: 'asc' });
  });
  it('does not claim a following page when a backward search is empty', async () => {
    const { catalogue, cursors } = await setup();
    const before = await Effect.runPromise(cursors.encode(['a']));
    expect(await Effect.runPromise(catalogue.search({ last: 2, before }))).toMatchObject({
      value: { pageInfo: { hasNextPage: false, hasPreviousPage: false } },
    });
  });
  it('rejects invalid cursors before reading the catalogue', async () => {
    const { read, catalogue } = await setup();
    expect(await Effect.runPromise(catalogue.search({ after: 'tampered' }))).toEqual({
      _tag: 'InvalidCursor',
    });
    expect(read.selections).toEqual([]);
  });
  it.each([
    { first: 101, after: 'tampered' },
    { last: 101, before: 'tampered' },
    { first: 50_000, after: 'tampered' },
    { last: 50_000, before: 'tampered' },
  ])('rejects oversized pagination %j before cursor and catalogue access', async (query) => {
    const { read, catalogue } = await setup();
    expect(await Effect.runPromise(catalogue.search(query))).toEqual({
      _tag: 'InvalidSearch',
      reason: 'Page size must be an integer between 1 and 100',
    });
    expect(read.selections).toEqual([]);
  });
  it.each([
    'first',
    'last',
  ] as const)('accepts a maximum %s page with one lookahead result', async (direction) => {
    const { read, catalogue, cursors } = await setup();
    const cursor = await Effect.runPromise(cursors.encode(['boundary']));
    const query =
      direction === 'first' ? { first: 100, after: cursor } : { last: 100, before: cursor };
    expect(await Effect.runPromise(catalogue.search(query))).toMatchObject({ _tag: 'Found' });
    expect(read.selections).toEqual([
      { size: 101, sortOrder: direction === 'first' ? 'asc' : 'desc', searchAfter: ['boundary'] },
    ]);
  });
  it('preserves first precedence when both page sizes are valid', async () => {
    const { read, catalogue } = await setup();
    expect(await Effect.runPromise(catalogue.search({ first: 2, last: 100 }))).toMatchObject({
      _tag: 'Found',
    });
    expect(read.selections).toEqual([{ size: 3, sortOrder: 'asc' }]);
  });
  it('rejects an oversized last even when first selects a smaller page', async () => {
    const { read, catalogue } = await setup();
    expect(await Effect.runPromise(catalogue.search({ first: 2, last: 101 }))).toMatchObject({
      _tag: 'InvalidSearch',
    });
    expect(read.selections).toEqual([]);
  });
  it('propagates typed catalogue unavailability', async () => {
    const { read, catalogue } = await setup();
    read.unavailable = true;
    expect(await Effect.runPromise(Effect.flip(catalogue.search({})))).toMatchObject({
      _tag: 'CatalogueUnavailable',
    });
    expect(await Effect.runPromise(Effect.flip(catalogue.wallpaper('wlpr_a')))).toMatchObject({
      _tag: 'CatalogueUnavailable',
    });
    expect(await Effect.runPromise(Effect.flip(catalogue.profile('p')))).toMatchObject({
      _tag: 'CatalogueUnavailable',
    });
    expect(await Effect.runPromise(Effect.flip(catalogue.profileByHandle('h')))).toMatchObject({
      _tag: 'CatalogueUnavailable',
    });
    expect(await Effect.runPromise(Effect.flip(catalogue.profiles(['p'])))).toMatchObject({
      _tag: 'CatalogueUnavailable',
    });
  });
  it('reads wallpapers and missing public records', async () => {
    const { read, catalogue } = await setup();
    read.wallpapers.set('wlpr_a', wallpaper('wlpr_a'));
    expect(await Effect.runPromise(catalogue.wallpaper('wlpr_a'))).toEqual(wallpaper('wlpr_a'));
    expect(await Effect.runPromise(catalogue.wallpaper('wlpr_missing'))).toBeNull();
    expect(await Effect.runPromise(catalogue.profile('p'))).toBeNull();
    expect(await Effect.runPromise(catalogue.profileByHandle('h'))).toBeNull();
    expect(await Effect.runPromise(catalogue.profiles(['p', 'p']))).toEqual([null, null]);
  });
  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rejects invalid page size %s without reading', async (first) => {
    const { read, catalogue } = await setup();
    expect(await Effect.runPromise(catalogue.search({ first }))).toMatchObject({
      _tag: 'InvalidSearch',
    });
    expect(read.selections).toEqual([]);
  });
  it('resolves case-insensitive Handles and preserves Profile batch order and duplicate slots', async () => {
    const { read, catalogue } = await setup();
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
    expect(await Effect.runPromise(catalogue.profile('p'))).toEqual(profile);
    expect(await Effect.runPromise(catalogue.profileByHandle('ARTIST'))).toEqual(profile);
    expect(await Effect.runPromise(catalogue.profiles(['p', 'missing', 'p']))).toEqual([
      profile,
      null,
      profile,
    ]);
    expect(await Effect.runPromise(catalogue.profiles([]))).toEqual([]);
  });
  it('returns a backward boundary page without claiming earlier results', async () => {
    const { catalogue, read, cursors } = await setup();
    const before = await Effect.runPromise(cursors.encode(['b']));
    read.response = {
      entries: [{ wallpaper: wallpaper('a'), cursor: ['a'] }],
      total: 2,
    };
    expect(await Effect.runPromise(catalogue.search({ last: 2, before }))).toMatchObject({
      value: { pageInfo: { hasNextPage: true, hasPreviousPage: false } },
    });
  });
});

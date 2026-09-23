import { it as effectIt } from '@effect/vitest';
import { Client } from '@opensearch-project/opensearch';
import { DateTime, Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OpenSearchGateway } from '../src/adapters/opensearch/index.js';
import type { Profile, ProfileSearchSelection } from '../src/catalogue/index.js';
import type { ProjectCatalogue } from '../src/projection/index.js';
import { acquireSearchFixture, createSearchFixture } from './search-fixture.js';

const timestamp = '2026-01-01T00:00:00.000Z';

describe('OpenSearch Profile discovery port contract', () => {
  const searchFixture = createSearchFixture();
  let adapter: OpenSearchGateway;
  let project: ProjectCatalogue;
  let client: Client;
  let fixture: Awaited<ReturnType<typeof acquireSearchFixture>>;
  beforeAll(async () => {
    fixture = await acquireSearchFixture(searchFixture.options);
    adapter = fixture.adapter;
    project = fixture.project;
    client = new Client({ node: searchFixture.options.url });
  }, 120_000);
  afterAll(async () => {
    await client?.close();
    await fixture?.dispose();
    await searchFixture.destroy();
  });

  async function publish(overrides: Partial<Profile> & Pick<Profile, 'id' | 'handle'>) {
    const profile: Profile = {
      displayName: 'Contributor',
      claimGeneration: 1,
      aliases: [],
      biographyMarkdown: '',
      pictureAssetId: null,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...overrides,
    };
    await Effect.runPromise(
      project.record({
        _tag: 'ProfilePublished',
        profile,
        occurrence: {
          source: 'wallpaperdb/profile',
          id: `${profile.id}-${profile.version}`,
          occurredAt: timestamp,
        },
      })
    );
    return profile;
  }
  function search(query: string, selection: Partial<ProfileSearchSelection> = {}) {
    return Effect.runPromise(adapter.read.searchProfiles({ query, size: 50, ...selection }));
  }

  it('ranks current Handles, active aliases and Display names in strict non-additive tiers', async () => {
    await publish({ id: 'rank-7', handle: 'aurora', displayName: 'Aurora' });
    await publish({ id: 'rank-6', handle: 'aurora-ridge' });
    await publish({
      id: 'rank-5',
      handle: 'renamed-exact',
      displayName: 'Aurora Aurora Aurora',
      aliases: [
        { handle: 'aurora', claimGeneration: 2 },
        { handle: 'aurora-one', claimGeneration: 3 },
        { handle: 'aurora-two', claimGeneration: 4 },
        { handle: 'aurora-three', claimGeneration: 5 },
      ],
    });
    await publish({
      id: 'rank-4',
      handle: 'renamed-prefix',
      displayName: 'Aurora',
      aliases: [{ handle: 'aurora-hill', claimGeneration: 2 }],
    });
    await publish({ id: 'rank-3', handle: 'phrase-artist', displayName: 'The Aurora Artist' });
    await publish({ id: 'rank-2', handle: 'prefix-artist', displayName: 'Auroral Painter' });
    await publish({ id: 'rank-1', handle: 'fuzzy-artist', displayName: 'Aurorra' });
    const result = await search('aurora');
    expect(
      result.entries.map(({ profile, cursor }) => ({ id: profile.id, score: cursor[0] }))
    ).toEqual([
      { id: 'rank-7', score: 6 },
      { id: 'rank-6', score: 5 },
      { id: 'rank-5', score: 4 },
      { id: 'rank-4', score: 3 },
      { id: 'rank-2', score: 2 },
      { id: 'rank-3', score: 2 },
      { id: 'rank-1', score: 1 },
    ]);
  });

  it('paginates stable rank and immutable ID without repeats when index statistics change', async () => {
    for (const suffix of ['05', '01', '04', '02', '03']) {
      await publish({ id: `constellation-${suffix}`, handle: `constellation-${suffix}` });
    }
    const first = await search('constellation', { size: 2 });
    expect(first.entries.map(({ profile }) => profile.id)).toEqual([
      'constellation-01',
      'constellation-02',
    ]);
    await publish({
      id: 'constellation-name',
      handle: 'sky-painter',
      displayName: 'Constellation Painter',
    });
    const second = await search('constellation', {
      size: 2,
      searchAfter: first.entries.at(-1)?.cursor,
    });
    expect(second.entries.map(({ profile }) => profile.id)).toEqual([
      'constellation-03',
      'constellation-04',
    ]);
    const third = await search('constellation', {
      size: 2,
      searchAfter: second.entries.at(-1)?.cursor,
    });
    expect(third.entries.map(({ profile }) => profile.id)).toEqual([
      'constellation-05',
      'constellation-name',
    ]);
    expect(
      (await search('constellation', { size: 2, searchAfter: third.entries.at(-1)?.cursor }))
        .entries
    ).toEqual([]);
  });

  effectIt.effect('expires only the matching alias at its exact deadline', () =>
    Effect.gen(function* () {
      const expiresAt = '2030-01-01T00:00:00.000Z';
      yield* Effect.promise(() =>
        publish({
          id: 'expiry-retained',
          handle: 'expiry-retained-owner',
          aliases: [{ handle: 'expirydiscovery-retained', claimGeneration: 2 }],
        })
      );
      yield* Effect.promise(() =>
        publish({
          id: 'expiry-scheduled',
          handle: 'expiry-scheduled-owner',
          aliases: [
            { handle: 'expirydiscovery', claimGeneration: 2, expiresAt },
            { handle: 'unrelated-retained', claimGeneration: 3 },
          ],
        })
      );
      yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(expiresAt)) - 1);
      const before = yield* adapter.read.searchProfiles({ query: 'expirydiscovery', size: 10 });
      expect(before.entries.map(({ profile }) => profile.id)).toEqual([
        'expiry-scheduled',
        'expiry-retained',
      ]);
      yield* TestClock.adjust(1);
      const after = yield* adapter.read.searchProfiles({ query: 'expirydiscovery', size: 10 });
      expect(after.entries.map(({ profile }) => profile.id)).toEqual(['expiry-retained']);
    })
  );

  it('keeps current Handle discovery ahead of newer alias claims while exact resolution honors claim generation', async () => {
    const current = await publish({
      id: 'claim-old-current',
      handle: 'reclaimeddiscovery',
      claimGeneration: 10,
    });
    const alias = await publish({
      id: 'claim-new-alias',
      handle: 'new-claim-owner',
      claimGeneration: 20,
      aliases: [{ handle: 'reclaimeddiscovery', claimGeneration: 11 }],
    });
    const stale = await publish({
      id: 'claim-stale-alias',
      handle: 'unrelated-claim',
      claimGeneration: 100,
      aliases: [
        { handle: 'reclaimeddiscovery', claimGeneration: 9 },
        { handle: 'unrelated-old-alias', claimGeneration: 99 },
      ],
    });
    expect((await search('reclaimeddiscovery')).entries.map(({ profile }) => profile)).toEqual([
      current,
      alias,
      stale,
    ]);
    expect(await Effect.runPromise(adapter.read.profileByHandle('reclaimeddiscovery'))).toEqual(
      alias
    );
  });

  it('returns canonical snapshots for active alias matches without searching Biography', async () => {
    const snapshot = await publish({
      id: 'search-biography',
      handle: 'canonical-biography-owner',
      aliases: [{ handle: 'formerdiscoveryname', claimGeneration: 2 }],
      biographyMarkdown: 'biographyuniqueneedle',
    });
    expect((await search('formerdiscoveryname')).entries.map(({ profile }) => profile)).toEqual([
      snapshot,
    ]);
    expect((await search('biographyuniqueneedle')).entries).toEqual([]);
    expect((await search('missing-discovery-query')).entries).toEqual([]);
  });

  it('continues filtering wallpapers by exact immutable Profile ID after a discovered Profile changes Handle', async () => {
    const selected = await publish({
      id: 'selected-profile',
      handle: 'skyartist',
      displayName: 'Blue Skies',
    });
    await publish({ id: 'other-profile', handle: 'other-artist', displayName: 'Blue Skies' });
    for (const [wallpaperId, profileId] of [
      ['selected-wallpaper', selected.id],
      ['same-name-wallpaper', 'other-profile'],
      ['prefix-wallpaper', `${selected.id}-extra`],
    ]) {
      await Effect.runPromise(
        project.record({
          _tag: 'WallpaperUploaded',
          wallpaperId,
          profileId,
          uploadedAt: timestamp,
          occurrence: { source: 'wallpaperdb/wallpaper', id: wallpaperId, occurredAt: timestamp },
        })
      );
    }
    const selectedId = (await search('skyartis')).entries[0].profile.id;
    await publish({ ...selected, handle: 'eveningartist', version: 2 });
    const wallpapers = await Effect.runPromise(
      adapter.read.search({ profileId: selectedId, size: 10, sortOrder: 'asc' })
    );
    expect(
      wallpapers.entries.map(({ wallpaper }) => [wallpaper.wallpaperId, wallpaper.profileId])
    ).toEqual([['selected-wallpaper', selected.id]]);
    expect((await Effect.runPromise(adapter.read.profile(selectedId)))?.handle).toBe(
      'eveningartist'
    );
  });

  it('rejects malformed projected discovery results as a typed storage failure', async () => {
    await client.index({
      index: searchFixture.index('profiles'),
      id: 'malformed-discovery',
      body: { id: 'malformed-discovery', handle: 'malformeddiscovery' },
      refresh: true,
    });
    expect(
      await Effect.runPromise(
        Effect.flip(adapter.read.searchProfiles({ query: 'malformeddiscovery', size: 10 }))
      )
    ).toMatchObject({ _tag: 'CatalogueUnavailable' });
  });
});

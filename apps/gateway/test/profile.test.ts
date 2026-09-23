import { Client } from '@opensearch-project/opensearch';
import { it as effectIt } from '@effect/vitest';
import { DateTime, Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OpenSearchGateway } from '../src/adapters/opensearch/index.js';
import type { Profile } from '../src/catalogue/index.js';
import type { ProjectCatalogue } from '../src/projection/index.js';
import { acquireSearchFixture, createSearchFixture } from './search-fixture.js';

const timestamp = '2026-01-01T00:00:00.000Z';
function profile(id: string, overrides: Partial<Profile> = {}): Profile {
  return {
    id,
    displayName: id,
    handle: id,
    claimGeneration: 1,
    biographyMarkdown: '',
    pictureAssetId: null,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

describe('OpenSearch profile projection port contract', () => {
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

  function publish(snapshot: Profile) {
    return Effect.runPromise(
      project.record({
        _tag: 'ProfilePublished',
        profile: snapshot,
        occurrence: {
          source: 'wallpaperdb/profile',
          id: `${snapshot.id}-${snapshot.version}`,
          occurredAt: snapshot.updatedAt,
        },
      })
    );
  }
  async function byId(id: string) {
    return Effect.runPromise(adapter.read.profile(id));
  }
  async function byHandle(handle: string) {
    return Effect.runPromise(adapter.read.profileByHandle(handle));
  }

  it('stores and reads the gateway-owned profile snapshot', async () => {
    const snapshot = profile('profile-reader', {
      displayName: 'Reader',
      biographyMarkdown: 'A biography',
      pictureAssetId: 'picture-1',
    });
    expect(await publish(snapshot)).toEqual({ _tag: 'Completed' });
    expect(await byId(snapshot.id)).toEqual(snapshot);
    expect(await byHandle('PROFILE-READER')).toEqual(snapshot);
    expect(await byHandle('profile-read')).toBeNull();
  });

  it.each([
    'without-aliases',
    'without-lifetimes',
  ])('upgrades an existing Profile index %s without losing stored Profiles', async (legacy) => {
    const existing = createSearchFixture();
    const snapshot = profile(`legacy-${legacy}`);
    let upgraded: Awaited<ReturnType<typeof acquireSearchFixture>> | undefined;
    try {
      await client.indices.create({
        index: existing.index('profiles'),
        body: {
          mappings: {
            properties: {
              id: { type: 'keyword' },
              displayName: { type: 'text' },
              handle: { type: 'keyword' },
              claimGeneration: { type: 'long' },
              biographyMarkdown: { type: 'text', index: false },
              pictureAssetId: { type: 'keyword' },
              version: { type: 'long' },
              createdAt: { type: 'date' },
              updatedAt: { type: 'date' },
              ...(legacy === 'without-lifetimes'
                ? {
                    aliases: {
                      type: 'nested',
                      properties: {
                        handle: { type: 'keyword' },
                        claimGeneration: { type: 'long' },
                      },
                    },
                  }
                : {}),
            },
          },
        },
      });
      await client.index({
        index: existing.index('profiles'),
        id: snapshot.id,
        body: snapshot,
        refresh: true,
      });
      upgraded = await acquireSearchFixture(existing.options);
      expect(await Effect.runPromise(upgraded.adapter.read.profile(snapshot.id))).toEqual(snapshot);
      const withAlias = {
        ...snapshot,
        version: 2,
        aliases: [
          {
            handle: `${snapshot.id}-alias`,
            claimGeneration: 1,
            createdAt: timestamp,
            expiresAt: null,
          },
        ],
      };
      await Effect.runPromise(
        upgraded.project.record({
          _tag: 'ProfilePublished',
          profile: withAlias,
          occurrence: {
            source: 'wallpaperdb/profile',
            id: `${snapshot.id}-2`,
            occurredAt: timestamp,
          },
        })
      );
      expect(
        await Effect.runPromise(upgraded.adapter.read.profileByHandle(withAlias.aliases[0].handle))
      ).toEqual(withAlias);
      const mapping = await client.indices.get({ index: existing.index('profiles') });
      expect(mapping.body[existing.index('profiles')].mappings.properties.aliases).toMatchObject({
        type: 'nested',
        properties: { createdAt: { type: 'date' }, expiresAt: { type: 'date' } },
      });
    } finally {
      await upgraded?.dispose();
      await existing.destroy();
    }
  });

  it('updates the complete profile snapshot when its version advances', async () => {
    const original = profile('profile-updated');
    await publish(original);
    const current = {
      ...original,
      displayName: 'Current',
      handle: 'current-handle',
      biographyMarkdown: 'Updated biography',
      pictureAssetId: 'picture-2',
      version: 2,
      updatedAt: '2026-02-01T00:00:00.000Z',
    };
    await publish(current);
    expect(await byId(original.id)).toEqual(current);
    expect(await byHandle(original.handle)).toBeNull();
    expect(await byHandle(current.handle)).toEqual(current);
  });

  it('retains alias snapshots and their lifetime metadata across every read boundary', async () => {
    const snapshot = profile('alias-snapshot', {
      handle: 'current-alias-owner',
      claimGeneration: 4,
      aliases: [
        { handle: 'retained-alias', claimGeneration: 1 },
        { handle: 'lifetime-alias', claimGeneration: 2, createdAt: timestamp, expiresAt: null },
        { handle: 'scheduled-alias', claimGeneration: 3, expiresAt: '2099-01-01T00:00:00.000Z' },
      ],
    });
    await publish(snapshot);
    expect(await byId(snapshot.id)).toEqual(snapshot);
    expect(await byHandle('LIFETIME-ALIAS')).toEqual(snapshot);
    expect(await Effect.runPromise(adapter.read.profiles([snapshot.id]))).toEqual([snapshot]);
  });

  it('compares the requested claim generation rather than unrelated Handles or aliases', async () => {
    const stale = profile('stale-alias-owner', {
      handle: 'unrelated-current',
      claimGeneration: 100,
      aliases: [
        { handle: 'reclaimed-current-alias', claimGeneration: 10 },
        { handle: 'reclaimed-former-alias', claimGeneration: 20 },
        { handle: 'unrelated-alias', claimGeneration: 99 },
      ],
    });
    const current = profile('current-claim-winner', {
      handle: 'reclaimed-current-alias',
      claimGeneration: 11,
    });
    const alias = profile('alias-claim-winner', {
      handle: 'new-alias-owner',
      claimGeneration: 40,
      aliases: [{ handle: 'reclaimed-former-alias', claimGeneration: 21 }],
    });
    await publish(stale);
    await publish(current);
    await publish(alias);
    expect(await byHandle('reclaimed-current-alias')).toEqual(current);
    expect(await byHandle('reclaimed-former-alias')).toEqual(alias);
  });

  effectIt.effect('stops resolving only the expired matching alias at its exact deadline', () =>
    Effect.gen(function* () {
      const expiresAt = '2030-01-02T12:00:00.000Z';
      const snapshot = profile('deadline-owner', {
        aliases: [
          { handle: 'deadline-alias', claimGeneration: 1, expiresAt },
          { handle: 'deadline-legacy', claimGeneration: 2 },
          { handle: 'deadline-retained', claimGeneration: 3, expiresAt: null },
        ],
      });
      yield* Effect.promise(() => publish(snapshot));
      const deadline = DateTime.toEpochMillis(DateTime.makeUnsafe(expiresAt));
      yield* TestClock.setTime(deadline - 1);
      expect(yield* adapter.read.profileByHandle('deadline-alias')).toEqual(snapshot);
      yield* TestClock.setTime(deadline);
      expect(yield* adapter.read.profileByHandle('deadline-alias')).toBeNull();
      expect(yield* adapter.read.profileByHandle('deadline-legacy')).toEqual(snapshot);
      expect(yield* adapter.read.profileByHandle('deadline-retained')).toEqual(snapshot);
      expect(yield* adapter.read.profileByHandle(snapshot.handle)).toEqual(snapshot);
    })
  );

  it('preserves authored Biography and picture removal when older snapshots replay', async () => {
    const authored =
      '## My work\n\n**Night skies** 🌌\n\n`<em>literal code</em>`\n\n![Aurora](wallpaper:wallpaper-1)';
    const initial = profile('authored-biography', {
      biographyMarkdown: authored,
      pictureAssetId: 'picture-imported',
    });
    await publish(initial);
    expect((await byId(initial.id))?.biographyMarkdown).toBe(authored);
    const replaced = { ...initial, pictureAssetId: 'picture-uploaded', version: 2 };
    await publish(replaced);
    const removed = { ...replaced, biographyMarkdown: '', pictureAssetId: null, version: 3 };
    await publish(removed);
    expect(await publish(replaced)).toEqual({ _tag: 'Ignored' });
    expect(await publish(initial)).toEqual({ _tag: 'Ignored' });
    expect(await byId(initial.id)).toEqual(removed);
  });

  effectIt.effect(
    'cancels alias expiry and restores released claims without stale replay undoing either',
    () =>
      Effect.gen(function* () {
        const expiresAt = '2030-01-02T12:00:00.000Z';
        const scheduledAlias = {
          handle: 'reactivated-alias',
          claimGeneration: 1,
          createdAt: timestamp,
          expiresAt,
        };
        const scheduled = profile('reactivated-owner', {
          aliases: [scheduledAlias],
          version: 2,
        });
        yield* Effect.promise(() => publish(scheduled));
        yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(expiresAt)));
        expect(yield* adapter.read.profileByHandle('reactivated-alias')).toBeNull();
        const reactivated = {
          ...scheduled,
          version: 3,
          aliases: [{ ...scheduledAlias, expiresAt: null }],
        };
        yield* Effect.promise(() => publish(reactivated));
        expect(yield* adapter.read.profileByHandle('reactivated-alias')).toEqual(reactivated);
        const released = { ...reactivated, version: 4, aliases: [] };
        yield* Effect.promise(() => publish(released));
        expect(yield* adapter.read.profileByHandle('reactivated-alias')).toBeNull();
        const restored = {
          ...reactivated,
          version: 5,
          aliases: [{ ...reactivated.aliases[0], claimGeneration: 6 }],
        };
        yield* Effect.promise(() => publish(restored));
        expect(yield* Effect.promise(() => publish(released))).toEqual({ _tag: 'Ignored' });
        expect(yield* Effect.promise(() => publish(scheduled))).toEqual({ _tag: 'Ignored' });
        expect(yield* adapter.read.profileByHandle('reactivated-alias')).toEqual(restored);
      })
  );

  it('ignores stale and duplicate profile versions atomically', async () => {
    const current = profile('profile-version', { version: 3, displayName: 'Current' });
    await publish(current);
    expect(await publish({ ...current, version: 2, displayName: 'Stale' })).toEqual({
      _tag: 'Ignored',
    });
    expect(await publish({ ...current, displayName: 'Duplicate overwrite' })).toEqual({
      _tag: 'Ignored',
    });
    expect(await byId(current.id)).toEqual(current);
  });

  it('converges on the greatest profile version during concurrent writes', async () => {
    const original = profile('profile-concurrent');
    await Promise.all([
      publish(original),
      publish({ ...original, version: 3 }),
      publish({ ...original, version: 2 }),
    ]);
    expect((await byId(original.id))?.version).toBe(3);
  });

  it('accepts an updated profile before its created event', async () => {
    const latest = profile('updated-before-created', { version: 2 });
    await publish(latest);
    await publish({ ...latest, version: 1 });
    expect(await byId(latest.id)).toEqual(latest);
  });

  it('chooses the latest handle claim when snapshots temporarily share a handle', async () => {
    const original = profile('original-claim', { handle: 'reclaimed-handle', claimGeneration: 1 });
    const current = profile('current-claim', { handle: 'reclaimed-handle', claimGeneration: 2 });
    await publish(current);
    await publish(original);
    expect(await byHandle('reclaimed-handle')).toEqual(current);
  });

  it('returns null for missing IDs and handles', async () => {
    expect(await byId('missing-id')).toBeNull();
    expect(await byHandle('missing-handle')).toBeNull();
  });

  it('preserves duplicate IDs, input order and missing slots in batch reads', async () => {
    const first = profile('batch-first');
    const second = profile('batch-second');
    await publish(first);
    await publish(second);
    expect(
      await Effect.runPromise(
        adapter.read.profiles([second.id, first.id, 'missing-batch', second.id])
      )
    ).toEqual([second, first, null, second]);
    expect(await Effect.runPromise(adapter.read.profiles([]))).toEqual([]);
  });

  it('rejects malformed stored profiles at each read boundary', async () => {
    await client.index({
      index: searchFixture.index('profiles'),
      id: 'malformed-profile',
      body: { id: 'malformed-profile', handle: 'malformed-profile', claimGeneration: 1 },
      refresh: true,
    });
    expect(
      await Effect.runPromise(Effect.flip(adapter.read.profile('malformed-profile')))
    ).toMatchObject({ _tag: 'CatalogueUnavailable' });
    expect(
      await Effect.runPromise(Effect.flip(adapter.read.profileByHandle('malformed-profile')))
    ).toMatchObject({ _tag: 'CatalogueUnavailable' });
    expect(
      await Effect.runPromise(Effect.flip(adapter.read.profiles(['malformed-profile'])))
    ).toMatchObject({ _tag: 'CatalogueUnavailable' });
  });
});

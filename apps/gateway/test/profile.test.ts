import { Client } from '@opensearch-project/opensearch';
import { Effect } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createOpenSearchGateway,
  type OpenSearchGateway,
} from '../src/adapters/opensearch/index.js';
import type { Profile, ReadOutcome } from '../src/catalogue/index.js';
import { createProjection, type ProjectCatalogue } from '../src/projection/index.js';
import { createSearchFixture } from './search-fixture.js';

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
function found<T>(outcome: ReadOutcome<T>): T {
  expect(outcome._tag).toBe('Found');
  if (outcome._tag !== 'Found') throw new Error('Catalogue unavailable');
  return outcome.value;
}

describe('OpenSearch profile projection port contract', () => {
  const searchFixture = createSearchFixture();
  let adapter: OpenSearchGateway;
  let project: ProjectCatalogue;
  let client: Client;
  beforeAll(async () => {
    adapter = createOpenSearchGateway(searchFixture.options);
    await adapter.start();
    project = createProjection(adapter.projectionStore);
    client = new Client({ node: searchFixture.options.url });
  }, 120_000);
  afterAll(async () => {
    await client?.close();
    await adapter?.stop();
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
    return found(await Effect.runPromise(adapter.read.profile(id)));
  }
  async function byHandle(handle: string) {
    return found(await Effect.runPromise(adapter.read.profileByHandle(handle)));
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
      found(
        await Effect.runPromise(
          adapter.read.profiles([second.id, first.id, 'missing-batch', second.id])
        )
      )
    ).toEqual([second, first, null, second]);
    expect(found(await Effect.runPromise(adapter.read.profiles([])))).toEqual([]);
  });

  it('rejects malformed stored profiles at each read boundary', async () => {
    await client.index({
      index: searchFixture.index('profiles'),
      id: 'malformed-profile',
      body: { id: 'malformed-profile', handle: 'malformed-profile', claimGeneration: 1 },
      refresh: true,
    });
    expect(await Effect.runPromise(adapter.read.profile('malformed-profile'))).toEqual({
      _tag: 'Unavailable',
    });
    expect(await Effect.runPromise(adapter.read.profileByHandle('malformed-profile'))).toEqual({
      _tag: 'Unavailable',
    });
    expect(await Effect.runPromise(adapter.read.profiles(['malformed-profile']))).toEqual({
      _tag: 'Unavailable',
    });
  });
});

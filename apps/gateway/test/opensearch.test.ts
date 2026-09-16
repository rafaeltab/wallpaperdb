import { once } from 'node:events';
import { createServer, request } from 'node:http';
import { Client } from '@opensearch-project/opensearch';
import { metrics } from '@opentelemetry/api';
import { Effect } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OpenSearchGateway } from '../src/adapters/opensearch/index.js';
import type {
  ReadOutcome,
  SearchBatch,
  SearchSelection,
  Variant,
  Wallpaper,
} from '../src/catalogue/index.js';
import type { ProjectCatalogue, ProjectionChange } from '../src/projection/index.js';
import { acquireSearchFixture, createSearchFixture } from './search-fixture.js';

const timestamp = '2026-01-01T00:00:00.000Z';
const variant: Variant = {
  width: 1920,
  height: 1080,
  aspectRatio: 1920 / 1080,
  format: 'image/jpeg',
  fileSizeBytes: 1000,
  createdAt: timestamp,
};
const occurrence = (id: string, time = timestamp) => ({
  source: 'wallpaperdb/test',
  id,
  occurredAt: time,
});
const colors = Array.from({ length: 64 }, (_, index) => (index === 0 ? 1 : 0));
function found<T>(outcome: ReadOutcome<T>): T {
  expect(outcome._tag).toBe('Found');
  if (outcome._tag !== 'Found') throw new Error('Catalogue unavailable');
  return outcome.value;
}

describe('OpenSearch catalogue port contract', () => {
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

  async function record(change: ProjectionChange) {
    return Effect.runPromise(project.record(change));
  }
  async function upload(id: string, owner = id) {
    return record({
      _tag: 'WallpaperUploaded',
      wallpaperId: id,
      profileId: owner,
      uploadedAt: timestamp,
      occurrence: occurrence(`upload-${id}`),
    });
  }
  async function addVariant(id: string, value = variant, time = timestamp) {
    return record({
      _tag: 'VariantAvailable',
      wallpaperId: id,
      variant: value,
      occurrence: occurrence(`variant-${id}-${value.width}`, time),
    });
  }
  async function addColors(id: string, histogram = colors, time = timestamp) {
    return record({
      _tag: 'ColorsExtracted',
      wallpaperId: id,
      colorHistogram: histogram,
      colorSpace: 'hsv',
      occurrence: occurrence(`colors-${id}`, time),
    });
  }
  async function get(id: string): Promise<Wallpaper | null> {
    return found(await Effect.runPromise(adapter.read.wallpaper(id)));
  }
  async function search(selection: Partial<SearchSelection>): Promise<SearchBatch> {
    return found(
      await Effect.runPromise(adapter.read.search({ size: 10, sortOrder: 'asc', ...selection }))
    );
  }

  it('aborts interrupted requests and closes in-flight transport work with the layer scope', async () => {
    let stalledRequests = 0;
    let activeRequests = 0;
    const server = createServer((incoming, outgoing) => {
      if (incoming.url?.includes('/_doc/stalled')) {
        stalledRequests++;
        activeRequests++;
        outgoing.once('close', () => {
          activeRequests--;
        });
        return;
      }
      const forwarded = request(
        new URL(incoming.url ?? '/', searchFixture.options.url),
        {
          method: incoming.method,
          headers: incoming.headers,
        },
        (response) => {
          outgoing.writeHead(response.statusCode ?? 500, response.headers);
          response.pipe(outgoing);
        }
      );
      forwarded.on('error', () => outgoing.destroy());
      incoming.pipe(forwarded);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
    const pending = await acquireSearchFixture({
      ...searchFixture.options,
      url: `http://127.0.0.1:${address.port}`,
    });
    try {
      const aborted = Effect.runPromise(
        pending.adapter.read
          .wallpaper('stalled-timeout')
          .pipe(Effect.timeout('200 millis'), Effect.result)
      );
      await expect.poll(() => stalledRequests).toBe(1);
      expect((await aborted)._tag).toBe('Failure');
      await expect.poll(() => activeRequests).toBe(0);
      const closing = Effect.runPromise(
        pending.adapter.read.wallpaper('stalled-shutdown').pipe(Effect.result)
      );
      await expect.poll(() => stalledRequests).toBe(2);
      await Effect.runPromise(
        Effect.tryPromise(() => pending.dispose()).pipe(Effect.timeout('2 seconds'))
      );
      expect((await closing)._tag).toBe('Failure');
      expect(activeRequests).toBe(0);
    } finally {
      await pending.dispose();
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    }
  });

  it('publishes a wallpaper and makes the completed write immediately readable', async () => {
    expect(await upload('published')).toEqual({ _tag: 'Completed' });
    expect(await get('published')).toEqual({
      wallpaperId: 'published',
      profileId: 'published',
      variants: [],
      uploadedAt: timestamp,
      updatedAt: timestamp,
    });
  });

  it('keeps projection and read outcomes authoritative when metric recording fails', async () => {
    metrics.setGlobalMeterProvider({
      getMeter() {
        throw new Error('Metrics unavailable');
      },
    });
    try {
      expect(await upload('telemetry-failure')).toEqual({ _tag: 'Completed' });
      expect((await get('telemetry-failure'))?.wallpaperId).toBe('telemetry-failure');
      expect((await search({ profileId: 'telemetry-failure' })).entries).toHaveLength(1);
      expect(await upload('telemetry-failure')).toEqual({ _tag: 'Ignored' });
    } finally {
      metrics.disable();
    }
  });

  it('retains enrichment when an upload is replayed', async () => {
    await upload('replayed');
    await addVariant('replayed');
    await addColors('replayed');
    expect(await upload('replayed')).toEqual({ _tag: 'Ignored' });
    expect(await get('replayed')).toMatchObject({ variants: [variant] });
    const persisted = await client.get({
      index: searchFixture.index('wallpapers'),
      id: 'replayed',
    });
    expect(persisted.body._source.colorHistogram).toEqual(colors);
  });

  it('durably retains enrichment arriving before upload and hides unfinished wallpapers from readers', async () => {
    await Promise.all([addVariant('out-of-order'), addColors('out-of-order')]);
    expect(await get('out-of-order')).toBeNull();
    const before = await search({ size: 100 });
    expect(before.entries).toHaveLength(before.total);
    expect(before.entries.some((entry) => entry.wallpaper.wallpaperId === 'out-of-order')).toBe(
      false
    );
    await upload('out-of-order');
    expect(await get('out-of-order')).toMatchObject({ variants: [variant] });
    expect((await search({ profileId: 'out-of-order', colorVector: colors })).entries).toHaveLength(
      1
    );
  });

  it('deduplicates variant replay using its stable dimensions and format', async () => {
    await upload('variant-replay');
    await addVariant('variant-replay');
    expect(await addVariant('variant-replay')).toEqual({ _tag: 'Ignored' });
    expect(await get('variant-replay')).toMatchObject({ variants: [variant] });
  });

  it('merges concurrent distinct variants and complete color data atomically', async () => {
    await upload('concurrent');
    expect(
      await Promise.all([
        addVariant('concurrent'),
        addVariant('concurrent', { ...variant, width: 2560, height: 1440, format: 'image/webp' }),
        addColors('concurrent'),
      ])
    ).toEqual([{ _tag: 'Completed' }, { _tag: 'Completed' }, { _tag: 'Completed' }]);
    expect((await get('concurrent'))?.variants).toHaveLength(2);
    expect((await search({ profileId: 'concurrent', colorVector: colors })).entries).toHaveLength(
      1
    );
  });

  it('ignores older variant snapshots and advances updatedAt with event occurrence', async () => {
    await upload('variant-order');
    const current = { ...variant, fileSizeBytes: 2000 };
    await addVariant('variant-order', current, '2026-02-01T00:00:00.000Z');
    expect(await addVariant('variant-order')).toEqual({ _tag: 'Ignored' });
    expect(await get('variant-order')).toMatchObject({
      variants: [current],
      updatedAt: '2026-02-01T00:00:00.000Z',
    });
  });

  it('replaces a variant with a newer snapshot without changing variant count', async () => {
    await upload('variant-replace');
    await addVariant('variant-replace');
    const current = { ...variant, fileSizeBytes: 2000 };
    await addVariant('variant-replace', current, '2026-02-01T00:00:00.000Z');
    expect((await get('variant-replace'))?.variants).toEqual([current]);
  });

  it('preserves and independently filters different formats at the same dimensions', async () => {
    await upload('same-dimensions');
    const png = { ...variant, format: 'image/png' };
    await Promise.all([addVariant('same-dimensions'), addVariant('same-dimensions', png)]);
    expect((await get('same-dimensions'))?.variants).toEqual(
      expect.arrayContaining([variant, png])
    );
    expect((await get('same-dimensions'))?.variants).toHaveLength(2);
    expect(
      (
        await search({
          profileId: 'same-dimensions',
          variantFilters: { width: variant.width, height: variant.height, format: 'image/jpeg' },
        })
      ).entries
    ).toHaveLength(1);
    expect(
      (
        await search({
          profileId: 'same-dimensions',
          variantFilters: { width: variant.width, height: variant.height, format: 'image/png' },
        })
      ).entries
    ).toHaveLength(1);
  });

  it('retains the newer color snapshot when older extraction is replayed', async () => {
    await upload('color-order');
    const current = Array.from({ length: 64 }, (_, index) => (index === 10 ? 1 : 0));
    await addColors('color-order', current, '2026-02-01T00:00:00.000Z');
    expect(await addColors('color-order')).toEqual({ _tag: 'Ignored' });
    const persisted = await client.get({
      index: searchFixture.index('wallpapers'),
      id: 'color-order',
    });
    expect(persisted.body._source.colorHistogram).toEqual(current);
  });

  it('preserves newer enrichment timestamp when the initial upload arrives late', async () => {
    await addVariant('late-upload', variant, '2026-02-01T00:00:00.000Z');
    await upload('late-upload');
    expect((await get('late-upload'))?.updatedAt).toBe('2026-02-01T00:00:00.000Z');
  });

  it('returns null for a missing wallpaper', async () => {
    expect(await get('missing')).toBeNull();
  });

  it('filters by profile and requires all variant constraints to match the same variant', async () => {
    await upload('nested-match', 'nested');
    await upload('nested-mismatch', 'nested');
    await upload('other-owner');
    await addVariant('nested-match', {
      ...variant,
      width: 2560,
      height: 1440,
      format: 'image/png',
    });
    await addVariant('nested-mismatch', { ...variant, width: 2560, height: 1440 });
    await addVariant('nested-mismatch', { ...variant, format: 'image/png' });
    await addVariant('other-owner', { ...variant, width: 2560, height: 1440, format: 'image/png' });
    const result = await search({
      profileId: 'nested',
      variantFilters: {
        width: 2560,
        height: 1440,
        aspectRatio: variant.aspectRatio,
        format: 'image/png',
      },
    });
    expect(result.entries.map((entry) => entry.wallpaper.wallpaperId)).toEqual(['nested-match']);
    expect(result.total).toBe(1);
  });

  it('accepts empty and omitted variant filters', async () => {
    await upload('empty-filter');
    expect((await search({ profileId: 'empty-filter', variantFilters: {} })).entries).toHaveLength(
      1
    );
    expect(
      (await search({ profileId: 'empty-filter', variantFilters: { width: undefined } })).entries
    ).toHaveLength(1);
  });

  it('returns an empty page for unmatched filters', async () => {
    expect(await search({ profileId: 'missing-profile' })).toEqual({ entries: [], total: 0 });
  });

  it('paginates in both directions with stable search-after cursors', async () => {
    for (let index = 0; index < 4; index++) await upload(`pagination-${index}`, 'pagination');
    const first = await search({ profileId: 'pagination', size: 2 });
    expect(first.entries.map((entry) => entry.wallpaper.wallpaperId)).toEqual([
      'pagination-0',
      'pagination-1',
    ]);
    const second = await search({
      profileId: 'pagination',
      size: 2,
      searchAfter: first.entries.at(-1)?.cursor,
    });
    expect(second.entries.map((entry) => entry.wallpaper.wallpaperId)).toEqual([
      'pagination-2',
      'pagination-3',
    ]);
    const previous = await search({
      profileId: 'pagination',
      size: 2,
      searchAfter: second.entries[0]?.cursor,
      sortOrder: 'desc',
    });
    expect(previous.entries.map((entry) => entry.wallpaper.wallpaperId)).toEqual([
      'pagination-1',
      'pagination-0',
    ]);
  });

  it('sorts color similarity with a deterministic wallpaper tie breaker and score cursor', async () => {
    for (const id of ['similarity-a', 'similarity-b', 'similarity-c']) {
      await upload(id, 'similarity');
      await addColors(id);
    }
    const first = await search({
      profileId: 'similarity',
      colorVector: colors,
      sortOrder: 'desc',
      size: 2,
    });
    expect(first.entries.map((entry) => entry.wallpaper.wallpaperId)).toEqual([
      'similarity-a',
      'similarity-b',
    ]);
    expect(first.entries[0]?.cursor).toEqual([expect.any(Number), 'similarity-a']);
    const second = await search({
      profileId: 'similarity',
      colorVector: colors,
      sortOrder: 'desc',
      searchAfter: first.entries.at(-1)?.cursor,
    });
    expect(second.entries.map((entry) => entry.wallpaper.wallpaperId)).toEqual(['similarity-c']);
    const previous = await search({
      profileId: 'similarity',
      colorVector: colors,
      sortOrder: 'asc',
      searchAfter: second.entries[0]?.cursor,
    });
    expect(previous.entries.map((entry) => entry.wallpaper.wallpaperId)).toEqual([
      'similarity-b',
      'similarity-a',
    ]);
  });

  it('treats malformed persisted data as unavailable rather than asserting it is a wallpaper', async () => {
    const malformedFixture = createSearchFixture();
    const malformed = await acquireSearchFixture(malformedFixture.options);
    const malformedAdapter = malformed.adapter;
    const malformedClient = new Client({ node: malformedFixture.options.url });
    try {
      await malformedClient.index({
        index: malformedFixture.options.wallpaperIndex,
        id: 'malformed',
        body: { wallpaperId: 'malformed', userId: 'malformed' },
        refresh: true,
      });
      expect(
        await Effect.runPromise(Effect.flip(malformedAdapter.read.wallpaper('malformed')))
      ).toMatchObject({ _tag: 'CatalogueUnavailable' });
      expect(
        await Effect.runPromise(
          Effect.flip(
            malformedAdapter.read.search({ profileId: 'malformed', size: 10, sortOrder: 'asc' })
          )
        )
      ).toMatchObject({ _tag: 'CatalogueUnavailable' });
    } finally {
      try {
        await Promise.all([malformedClient.close(), malformed.dispose()]);
      } finally {
        await malformedFixture.destroy();
      }
    }
  });

  it('rejects impossible calendar dates in stored timestamps', async () => {
    const malformedFixture = createSearchFixture();
    const malformed = await acquireSearchFixture(malformedFixture.options);
    try {
      await client.indices.putMapping({
        index: malformedFixture.options.wallpaperIndex,
        body: { properties: { uploadedAt: { type: 'date', ignore_malformed: true } } },
      });
      for (const uploadedAt of [
        '2026-02-30T00:00:00.000Z',
        '1900-02-29T00:00:00Z',
        '2026-04-31T00:00:00Z',
      ]) {
        await client.index({
          index: malformedFixture.options.wallpaperIndex,
          id: 'invalid-calendar',
          body: {
            wallpaperId: 'invalid-calendar',
            userId: 'owner',
            variants: [],
            uploadedAt,
            updatedAt: timestamp,
          },
        });
        expect(
          await Effect.runPromise(Effect.flip(malformed.adapter.read.wallpaper('invalid-calendar')))
        ).toMatchObject({ _tag: 'CatalogueUnavailable' });
      }
    } finally {
      await malformed.dispose();
      await malformedFixture.destroy();
    }
  });

  it('preserves valid stored timestamp representations and fractional precision', async () => {
    for (const uploadedAt of [
      '2024-02-29T12:34:56.123456Z',
      '2000-02-29T12:34Z',
      '2026-01-01T00:00:00Z',
    ]) {
      await client.index({
        index: searchFixture.options.wallpaperIndex,
        id: 'timestamp-representation',
        body: {
          wallpaperId: 'timestamp-representation',
          userId: 'owner',
          variants: [],
          uploadedAt,
          updatedAt: timestamp,
        },
      });
      expect((await get('timestamp-representation'))?.uploadedAt).toBe(uploadedAt);
    }
  });

  it('translates a rejected storage mutation into a permanent application outcome', async () => {
    const strict = await acquireSearchFixture({
      ...searchFixture.options,
      wallpaperIndex: searchFixture.index('strict-wallpapers'),
    });
    await client.indices.delete({ index: searchFixture.index('strict-wallpapers') });
    await client.indices.create({
      index: searchFixture.index('strict-wallpapers'),
      body: { mappings: { dynamic: 'strict', properties: {} } },
    });
    try {
      expect(
        await Effect.runPromise(
          strict.project.record({
            _tag: 'WallpaperUploaded',
            wallpaperId: 'rejected',
            profileId: 'profile',
            uploadedAt: timestamp,
            occurrence: occurrence('rejected'),
          })
        )
      ).toEqual({ _tag: 'Rejected', reason: 'invalid-projection' });
    } finally {
      await strict.dispose();
    }
  });

  it('retains typed projection and catalogue failures for unavailable storage', async () => {
    const missing = await acquireSearchFixture({
      ...searchFixture.options,
      wallpaperIndex: searchFixture.index('closed-wallpapers'),
    });
    await client.indices.close({ index: searchFixture.index('closed-wallpapers') });
    try {
      expect(
        await Effect.runPromise(
          Effect.flip(
            missing.project.record({
              _tag: 'WallpaperUploaded',
              wallpaperId: 'retry',
              profileId: 'profile',
              uploadedAt: timestamp,
              occurrence: occurrence('retry'),
            })
          )
        )
      ).toMatchObject({ _tag: 'ProjectionUnavailable' });
      expect(
        await Effect.runPromise(Effect.flip(missing.adapter.read.wallpaper('retry')))
      ).toMatchObject({ _tag: 'CatalogueUnavailable' });
    } finally {
      await missing.dispose();
    }
  });

  it('distinguishes an unavailable index from an absent catalogue record', async () => {
    const missing = await acquireSearchFixture({
      ...searchFixture.options,
      wallpaperIndex: searchFixture.index('absent-wallpapers'),
      profileIndex: searchFixture.index('absent-profiles'),
    });
    await client.indices.delete({
      index: [searchFixture.index('absent-wallpapers'), searchFixture.index('absent-profiles')],
    });
    try {
      expect(
        await Effect.runPromise(Effect.flip(missing.adapter.read.wallpaper('missing')))
      ).toMatchObject({ _tag: 'CatalogueUnavailable' });
      expect(
        await Effect.runPromise(Effect.flip(missing.adapter.read.profile('missing')))
      ).toMatchObject({ _tag: 'CatalogueUnavailable' });
    } finally {
      await missing.dispose();
    }
  });

  it('upgrades existing projection mappings while preserving stored wallpapers and variants', async () => {
    await client.indices.create({
      index: searchFixture.index('legacy-wallpapers'),
      body: {
        settings: { index: { knn: true } },
        mappings: {
          properties: {
            wallpaperId: { type: 'keyword' },
            userId: { type: 'keyword' },
            uploadedAt: { type: 'date' },
            updatedAt: { type: 'date' },
            variants: {
              type: 'nested',
              properties: {
                width: { type: 'integer' },
                height: { type: 'integer' },
                aspectRatio: { type: 'float' },
                format: { type: 'keyword' },
                fileSizeBytes: { type: 'long' },
                createdAt: { type: 'date' },
              },
            },
          },
        },
      },
    });
    await client.index({
      index: searchFixture.index('legacy-wallpapers'),
      id: 'legacy',
      body: {
        wallpaperId: 'legacy',
        userId: 'legacy-profile',
        uploadedAt: timestamp,
        updatedAt: timestamp,
        variants: [variant],
      },
      refresh: true,
    });
    const upgraded = await acquireSearchFixture({
      ...searchFixture.options,
      wallpaperIndex: searchFixture.index('legacy-wallpapers'),
    });
    try {
      const mapping = await client.indices.getMapping({
        index: searchFixture.index('legacy-wallpapers'),
      });
      expect(
        mapping.body[searchFixture.index('legacy-wallpapers')].mappings.properties
      ).toMatchObject({
        variantOrder: { type: 'object', enabled: false },
        colorOrder: { type: 'keyword', index: false },
      });
      expect(
        found(await Effect.runPromise(upgraded.adapter.read.wallpaper('legacy')))?.variants
      ).toEqual([variant]);
      const stale = await Effect.runPromise(
        upgraded.project.record({
          _tag: 'VariantAvailable',
          wallpaperId: 'legacy',
          variant: { ...variant, fileSizeBytes: 1, createdAt: '2025-01-01T00:00:00Z' },
          occurrence: occurrence('legacy-stale', '2025-01-01T00:00:00.000Z'),
        })
      );
      expect(stale).toEqual({ _tag: 'Ignored' });
      expect(
        found(await Effect.runPromise(upgraded.adapter.read.wallpaper('legacy')))?.variants
      ).toEqual([variant]);
      await Effect.runPromise(
        upgraded.project.record({
          _tag: 'VariantAvailable',
          wallpaperId: 'legacy',
          variant: { ...variant, format: 'image/png' },
          occurrence: occurrence('legacy-new-format'),
        })
      );
      expect(
        found(await Effect.runPromise(upgraded.adapter.read.wallpaper('legacy')))?.variants
      ).toHaveLength(2);
    } finally {
      await upgraded.dispose();
    }
  });
});

import { once } from 'node:events';
import { createServer, request } from 'node:http';
import { it as effectIt } from '@effect/vitest';
import { Client } from '@opensearch-project/opensearch';
import { metrics } from '@opentelemetry/api';
import { Effect, Layer } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OpenSearchGateway, openSearchLayer } from '../src/adapters/opensearch/index.js';
import type {
  ColorDescriptor,
  SearchBatch,
  SearchSelection,
  Variant,
  Wallpaper,
} from '../src/capabilities/catalogue/index.js';
import type { ProjectCatalogue, ProjectionChange } from '../src/capabilities/projection/index.js';
import { colorUtilityFields, COLOR_UTILITY_VERSION } from '../src/capabilities/catalogue/index.js';
import { measuredColors, colorFixture } from './helpers/colors.js';
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
const colors = colorFixture.descriptor;

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
  async function addColors(id: string, descriptor: ColorDescriptor = colors, time = timestamp) {
    return record({ ...measuredColors(id, time), descriptor });
  }
  async function bank(id: string) {
    const fields: Record<string, number> = {};
    for (let start = 0; start < colorUtilityFields.length; start += 90) {
      const selected = colorUtilityFields.slice(start, start + 90);
      const result = await client.search({
        index: searchFixture.index('wallpapers'),
        body: {
          _source: false,
          query: { term: { wallpaperId: id } },
          size: 1,
          docvalue_fields: [
            'wallpaperId',
            'colorReady',
            ...selected.map((key) => `utilities.${key}`),
          ],
        },
      });
      const hit = result.body.hits.hits[0];
      expect(hit.fields.wallpaperId).toEqual([id]);
      expect(hit.fields.colorReady).toEqual([COLOR_UTILITY_VERSION]);
      for (const key of selected) fields[key] = Math.fround(hit.fields[`utilities.${key}`][0]);
    }
    return fields;
  }
  async function get(id: string): Promise<Wallpaper | null> {
    return Effect.runPromise(adapter.read.wallpaper(id));
  }
  async function search(selection: Partial<SearchSelection>): Promise<SearchBatch> {
    return Effect.runPromise(adapter.read.search({ size: 10, sortOrder: 'asc', ...selection }));
  }

  effectIt.live('reports invalid connection configuration as a startup failure', () =>
    Effect.gen(function* () {
      const error = yield* Layer.build(openSearchLayer({ url: 'not-a-url' })).pipe(Effect.flip);
      expect(error._tag).toBe('OpenSearchStartupError');
    })
  );

  it.each([
    { label: 'non-nested variants', field: 'variants', replacement: { type: 'object' } },
    { label: 'nested utility fields', field: 'utilities', replacement: { type: 'nested' } },
    { label: 'disabled utility indexing', field: 'utilities', replacement: { enabled: false } },
    { label: 'dynamic utility fields', field: 'utilities', replacement: { dynamic: true } },
    {
      label: 'ignored unknown utility fields',
      field: 'utilities',
      replacement: { dynamic: false },
    },
    {
      label: 'a source allowlist dropping measurements and color occurrence metadata',
      field: '_source',
      replacement: {
        includes: ['wallpaperId', 'userId', 'variants', 'uploadedAt', 'updatedAt'],
      },
    },
    {
      label: 'a source allowlist dropping variant occurrence metadata',
      field: '_source',
      replacement: {
        includes: [
          'wallpaperId',
          'userId',
          'variants',
          'uploadedAt',
          'updatedAt',
          'colorSnapshot',
          'colorReady',
          'colorOrder',
        ],
      },
    },
    {
      label: 'dynamically indexed measurements',
      field: 'colorSnapshot',
      replacement: { enabled: true },
    },
    {
      label: 'dynamically indexed variant occurrence order',
      field: 'variantOrder',
      replacement: { enabled: true },
    },
    {
      label: 'unretrievable wallpaper IDs',
      field: 'wallpaperId',
      replacement: { doc_values: false },
    },
    {
      label: 'unsearchable contributor Profiles',
      field: 'userId',
      replacement: { index: false, doc_values: false },
    },
    {
      label: 'unsearchable color readiness',
      field: 'colorReady',
      replacement: { index: false, doc_values: false },
    },
    { label: 'indexed color occurrence order', field: 'colorOrder', replacement: { index: true } },
    { label: 'incompatible upload timestamps', field: 'uploadedAt', replacement: { type: 'long' } },
    { label: 'incompatible update timestamps', field: 'updatedAt', replacement: { type: 'long' } },
  ])('rejects an existing wallpaper mapping with $label at startup', async ({
    field,
    replacement,
  }) => {
    const index = searchFixture.index(`malformed-${field.toLowerCase()}`);
    const required = await client.indices.getMapping({
      index: searchFixture.options.wallpaperIndex,
    });
    const mapping = required.body[searchFixture.options.wallpaperIndex].mappings;
    try {
      await client.indices.create({
        index,
        body: {
          settings: { 'index.mapping.total_fields.limit': 10100 },
          mappings: {
            ...mapping,
            ...(field === '_source'
              ? { _source: { ...mapping._source, ...replacement } }
              : {
                  properties: {
                    ...mapping.properties,
                    [field]: { ...mapping.properties[field], ...replacement },
                  },
                }),
          },
        },
      });
      const result = await Effect.runPromise(
        Layer.build(openSearchLayer({ ...searchFixture.options, wallpaperIndex: index })).pipe(
          Effect.scoped,
          Effect.result
        )
      );
      expect(result._tag).toBe('Failure');
      if (result._tag === 'Failure')
        expect(result.failure.diagnostic).toMatchObject({
          dependency: 'opensearch',
          operation: 'inspect-index',
          index,
        });
    } finally {
      await client.indices.delete({ index, ignore_unavailable: true });
    }
  });

  it('accepts an existing complete wallpaper mapping with implicit native defaults', async () => {
    const existing = await acquireSearchFixture(searchFixture.options);
    try {
      expect(await Effect.runPromise(existing.adapter.check())).toBe(true);
    } finally {
      await existing.dispose();
    }
  });

  it.each([
    'strict_date_optional_time',
    'date_optional_time',
    'epoch_millis||strict_date_optional_time',
  ])('accepts ISO-compatible date format %s for projected timestamps', async (format) => {
    const index = searchFixture.index(`iso-dates-${format.replaceAll('|', '-').toLowerCase()}`);
    const required = await client.indices.getMapping({
      index: searchFixture.options.wallpaperIndex,
    });
    const mapping = structuredClone(required.body[searchFixture.options.wallpaperIndex].mappings);
    mapping.properties.uploadedAt.format = format;
    mapping.properties.updatedAt.format = format;
    mapping.properties.variants.properties.createdAt.format = format;
    try {
      await client.indices.create({
        index,
        body: {
          settings: { 'index.mapping.total_fields.limit': 10100 },
          mappings: mapping,
        },
      });
      const compatible = await acquireSearchFixture({
        ...searchFixture.options,
        wallpaperIndex: index,
      });
      try {
        await Effect.runPromise(
          compatible.project.record({
            _tag: 'WallpaperUploaded',
            wallpaperId: 'iso-date-projection',
            profileId: 'owner',
            uploadedAt: timestamp,
            occurrence: occurrence('iso-date-upload'),
          })
        );
        await Effect.runPromise(
          compatible.project.record({
            _tag: 'VariantAvailable',
            wallpaperId: 'iso-date-projection',
            variant,
            occurrence: occurrence('iso-date-variant'),
          })
        );
        const stored = await client.get({ index, id: 'iso-date-projection' });
        expect(stored.body._source).toMatchObject({
          uploadedAt: timestamp,
          updatedAt: timestamp,
          variants: [{ createdAt: timestamp }],
        });
      } finally {
        await compatible.dispose();
      }
    } finally {
      await client.indices.delete({ index, ignore_unavailable: true });
    }
  });

  it.each([
    'uploadedAt',
    'updatedAt',
    'variants.createdAt',
  ] as const)('rejects an existing %s date mapping that cannot parse ISO timestamps', async (field) => {
    const index = searchFixture.index(`epoch-millis-${field.replace('.', '-').toLowerCase()}`);
    const required = await client.indices.getMapping({
      index: searchFixture.options.wallpaperIndex,
    });
    const mapping = structuredClone(required.body[searchFixture.options.wallpaperIndex].mappings);
    const dateField =
      field === 'variants.createdAt'
        ? mapping.properties.variants.properties.createdAt
        : mapping.properties[field];
    dateField.format = 'epoch_millis';
    try {
      await client.indices.create({
        index,
        body: {
          settings: { 'index.mapping.total_fields.limit': 10100 },
          mappings: mapping,
        },
      });
      await expect(
        client.index({
          index,
          id: 'iso-date-probe',
          body: {
            wallpaperId: 'iso-date-probe',
            userId: 'owner',
            variants: [variant],
            uploadedAt: timestamp,
            updatedAt: timestamp,
          },
        })
      ).rejects.toMatchObject({ meta: { body: { error: { type: 'mapper_parsing_exception' } } } });

      const result = await Effect.runPromise(
        Layer.build(openSearchLayer({ ...searchFixture.options, wallpaperIndex: index })).pipe(
          Effect.scoped,
          Effect.result
        )
      );
      expect(result._tag).toBe('Failure');
      if (result._tag === 'Failure')
        expect(result.failure.diagnostic).toMatchObject({
          dependency: 'opensearch',
          operation: 'inspect-index',
          index,
        });
    } finally {
      await client.indices.delete({ index, ignore_unavailable: true });
    }
  });

  it('aborts interrupted requests and closes in-flight transport work with the layer scope', async () => {
    let stalledRequests = 0;
    let activeRequests = 0;
    let unavailable = false;
    const server = createServer((incoming, outgoing) => {
      if (unavailable) {
        outgoing.writeHead(503);
        outgoing.end();
        return;
      }
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
      expect(await Effect.runPromise(pending.adapter.check())).toBe(true);
      unavailable = true;
      expect(await Effect.runPromise(pending.adapter.check())).toBe(false);
      unavailable = false;
      expect(await Effect.runPromise(pending.adapter.check())).toBe(true);
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
    expect(persisted.body._source.colorSnapshot.descriptor).toEqual(colors);
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
    expect((await search({ profileId: 'out-of-order' })).entries).toHaveLength(1);
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
    expect((await search({ profileId: 'concurrent' })).entries).toHaveLength(1);
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
    const current = measuredColors('color-order', timestamp, 'dark-red').descriptor;
    await addColors('color-order', current, '2026-02-01T00:00:00.000Z');
    expect(await addColors('color-order')).toEqual({ _tag: 'Ignored' });
    const persisted = await client.get({
      index: searchFixture.index('wallpapers'),
      id: 'color-order',
    });
    expect(persisted.body._source.colorSnapshot.descriptor).toEqual(current);
  });

  it.each([
    false,
    true,
  ])('orders same-millisecond colors and variants precisely (newer first: %s)', async (newerFirst) => {
    const id = `precise-${newerFirst}`;
    await upload(id);
    const oldOccurrence = occurrence('z-older', '2026-01-01T00:00:00.1231Z');
    const newOccurrence = occurrence('a-newer', '2026-01-01T00:00:00.1239Z');
    const newerColors = measuredColors('precise', timestamp, 'dark-red').descriptor;
    const newerVariant = { ...variant, fileSizeBytes: 2000 };
    const events: ProjectionChange[] = [
      {
        ...measuredColors(id),
        occurrence: oldOccurrence,
        descriptor: colors,
      },
      { _tag: 'VariantAvailable', wallpaperId: id, occurrence: oldOccurrence, variant },
      {
        ...measuredColors(id),
        occurrence: newOccurrence,
        descriptor: newerColors,
      },
      {
        _tag: 'VariantAvailable',
        wallpaperId: id,
        occurrence: newOccurrence,
        variant: newerVariant,
      },
    ];
    for (const event of newerFirst ? [...events].reverse() : events) await record(event);
    for (const event of events) expect(await record(event)).toEqual({ _tag: 'Ignored' });
    expect((await get(id))?.variants).toEqual([newerVariant]);
    expect((await get(id))?.updatedAt).toBe('2026-01-01T00:00:00.123Z');
    const persisted = await client.get({ index: searchFixture.index('wallpapers'), id });
    expect(persisted.body._source.colorSnapshot.descriptor).toEqual(newerColors);
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

  async function faultyProjection(
    id: string,
    initial: 'stall' | 'conflict' | 'ambiguous' | 'unavailable'
  ) {
    const mode = initial;
    let writes = 0;
    const dependency = createServer((incoming, outgoing) => {
      const targeted = incoming.method === 'PUT' && incoming.url?.includes(`/_doc/${id}`);
      if (targeted) {
        writes++;
        if (mode === 'stall') return;
        if (mode === 'conflict' || mode === 'unavailable') {
          const status = mode === 'conflict' ? 409 : 503;
          outgoing.writeHead(status, { 'Content-Type': 'application/json' });
          outgoing.end(
            JSON.stringify({
              error: {
                type: mode === 'conflict' ? 'version_conflict_engine_exception' : 'unavailable',
              },
              status,
            })
          );
          return;
        }
      }
      const forwarded = request(
        new URL(incoming.url ?? '/', searchFixture.options.url),
        { method: incoming.method, headers: incoming.headers },
        (response) => {
          if (targeted && mode === 'ambiguous') {
            response.resume();
            response.once('end', () => {
              outgoing.writeHead(200, { 'Content-Type': 'application/json' });
              outgoing.end(
                JSON.stringify({
                  _index: searchFixture.options.wallpaperIndex,
                  _id: 'wrong-id',
                  result: 'updated',
                  _shards: { failed: 0 },
                })
              );
            });
          } else {
            outgoing.writeHead(response.statusCode ?? 500, response.headers);
            response.pipe(outgoing);
          }
        }
      );
      forwarded.on('error', () => outgoing.destroy());
      incoming.pipe(forwarded);
    });
    dependency.listen(0, '127.0.0.1');
    await once(dependency, 'listening');
    const address = dependency.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
    const proxied = await acquireSearchFixture({
      ...searchFixture.options,
      url: `http://127.0.0.1:${address.port}`,
    });
    return {
      project: proxied.project,
      writes: () => writes,
      async dispose() {
        await proxied.dispose();
        dependency.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          dependency.close((error) => (error ? reject(error) : resolve()))
        );
      },
    };
  }
  it.each([
    { mode: 'conflict' as const, attempts: 6 },
    { mode: 'unavailable' as const, attempts: 1 },
  ])('never marks rejected writes ready and bounds $mode attempts', async ({ mode, attempts }) => {
    const id = `fault-${mode}`;
    await upload(id);
    const fault = await faultyProjection(id, mode);
    try {
      expect(
        await Effect.runPromise(Effect.flip(fault.project.record(measuredColors(id))))
      ).toMatchObject({ _tag: 'ProjectionUnavailable' });
      expect(fault.writes()).toBe(attempts);
      const stored = await client.get({ index: searchFixture.options.wallpaperIndex, id });
      expect(stored.body._source.colorReady).toBeUndefined();
      expect(stored.body._source.colorSnapshot).toBeUndefined();
      await addColors(id);
      expect(await bank(id)).toEqual(colorFixture.utilities);
    } finally {
      await fault.dispose();
    }
  });
  it('replays an ambiguously acknowledged complete write without another write', async () => {
    const id = 'fault-ambiguous';
    await upload(id);
    const fault = await faultyProjection(id, 'ambiguous');
    try {
      expect(
        await Effect.runPromise(Effect.flip(fault.project.record(measuredColors(id))))
      ).toMatchObject({ _tag: 'ProjectionUnavailable' });
      expect(await bank(id)).toEqual(colorFixture.utilities);
      expect(await Effect.runPromise(fault.project.record(measuredColors(id)))).toEqual({
        _tag: 'Ignored',
      });
      expect(fault.writes()).toBe(1);
    } finally {
      await fault.dispose();
    }
  });
  it('keeps interrupted work ineligible until a complete retry commits', async () => {
    const id = 'fault-interrupted';
    await upload(id);
    const fault = await faultyProjection(id, 'stall');
    try {
      const pending = Effect.runPromise(
        fault.project.record(measuredColors(id)).pipe(Effect.timeout('200 millis'), Effect.result)
      );
      await expect.poll(fault.writes).toBe(1);
      expect((await pending)._tag).toBe('Failure');
      const stored = await client.get({ index: searchFixture.options.wallpaperIndex, id });
      expect(stored.body._source.colorReady).toBeUndefined();
      await addColors(id);
      expect(await bank(id)).toEqual(colorFixture.utilities);
    } finally {
      await fault.dispose();
    }
  });

  it('stores every complete utility as indexed float doc values without utility source', async () => {
    await upload('bank-parity');
    await addColors('bank-parity');
    expect(await bank('bank-parity')).toEqual(colorFixture.utilities);
    const stored = await client.get({
      index: searchFixture.index('wallpapers'),
      id: 'bank-parity',
    });
    expect(stored.body._source.utilities).toBeUndefined();
    expect(stored.body._source.colorHistogram).toBeUndefined();
    expect(stored.body._source.colorReady).toBe(COLOR_UTILITY_VERSION);
    const mapping = await client.indices.getMapping({ index: searchFixture.index('wallpapers') });
    const utilities = mapping.body[searchFixture.index('wallpapers')].mappings.properties.utilities;
    expect(Object.keys(utilities.properties)).toHaveLength(10044);
    expect(Object.values(utilities.properties)).toEqual(Array(10044).fill({ type: 'float' }));
  });
  it('keeps the entire utility bank after interleaved metadata updates and duplicate colors', async () => {
    await addColors('metadata-bank');
    await Promise.all([
      upload('metadata-bank'),
      addVariant('metadata-bank'),
      addVariant('metadata-bank', { ...variant, format: 'image/png' }),
    ]);
    expect(await addColors('metadata-bank')).toEqual({ _tag: 'Ignored' });
    expect(await bank('metadata-bank')).toEqual(colorFixture.utilities);
    expect((await get('metadata-bank'))?.variants).toHaveLength(2);
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
});

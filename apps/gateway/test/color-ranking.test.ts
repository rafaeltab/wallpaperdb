import { once } from 'node:events';
import { createServer, request } from 'node:http';
import { Client } from '@opensearch-project/opensearch';
import { Effect, Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  COLOR_UTILITY_VERSION,
  type SearchSelection,
} from '../src/capabilities/catalogue/index.js';
import { acquireSearchFixture, createSearchFixture } from './search-fixture.js';
import utilitiesReference from './fixtures/prototype/utilities.json';
import { rankingCases as references } from './helpers/color-ranking.js';

const referenceQuery = Schema.decodeUnknownSync(
  Schema.Struct({
    bool: Schema.Struct({
      must: Schema.Array(Schema.Unknown),
      should: Schema.Array(Schema.Unknown),
      minimum_should_match: Schema.Int,
    }),
  })
);
const timestamp = '2026-09-30T00:00:00.000Z';
const variant = {
  width: 1920,
  height: 1080,
  aspectRatio: 1920 / 1080,
  format: 'image/png',
  fileSizeBytes: 1,
  createdAt: timestamp,
};
const filters = [
  { exists: { field: 'userId' } },
  { term: { userId: 'ranking' } },
  { term: { colorReady: COLOR_UTILITY_VERSION } },
  {
    nested: {
      path: 'variants',
      query: {
        bool: {
          must: [{ term: { 'variants.width': 1920 } }, { term: { 'variants.height': 1080 } }],
        },
      },
    },
  },
];

describe('Native color ranking port contract', () => {
  const fixture = createSearchFixture();
  const client = new Client({ node: fixture.options.url });
  let resource: Awaited<ReturnType<typeof acquireSearchFixture>>;
  const selection = (color = references[0].ranking): SearchSelection => ({
    color,
    profileId: 'ranking',
    variantFilters: { width: 1920, height: 1080 },
    size: 100,
    sortOrder: 'desc',
  });
  beforeAll(async () => {
    resource = await acquireSearchFixture(fixture.options);
    const zeroBank = Object.fromEntries(
      Object.keys(utilitiesReference.cases[0].utilities).map((key) => [key, 0])
    );
    const index = async (
      id: string,
      utilities: Record<string, number>,
      extra: Record<string, unknown> = {}
    ) => {
      await client.index({
        index: fixture.options.wallpaperIndex,
        id,
        body: {
          wallpaperId: id,
          userId: 'ranking',
          variants: [variant],
          uploadedAt: timestamp,
          updatedAt: timestamp,
          colorReady: COLOR_UTILITY_VERSION,
          utilities,
          ...extra,
        },
      });
    };
    for (const entry of utilitiesReference.cases)
      await index(`fixture-${entry.name}`, entry.utilities);
    await index('tie-z', utilitiesReference.cases[0].utilities);
    await index('tie-a', utilitiesReference.cases[0].utilities);
    await index('zero-score', zeroBank);
    await index('near-a', { ...zeroBank, r0004_v_q050_w1: 0.5 });
    await index('near-b', { ...zeroBank, r0004_v_q050_w1: Math.fround(0.5 + 2 ** -24) });
    const highBank = Object.fromEntries(Object.keys(zeroBank).map((key) => [key, 1]));
    await index('incomplete', highBank, { colorReady: undefined });
    await index('incompatible', highBank, { colorReady: 'other-version' });
    await index('outside-profile', highBank, { userId: 'outside' });
    await index('missing-contributor', highBank, { userId: undefined });
    await index('outside-variant', highBank, {
      variants: [
        { ...variant, height: 720 },
        { ...variant, width: 800 },
      ],
    });
    await client.indices.refresh({ index: fixture.options.wallpaperIndex });
  });
  afterAll(async () => {
    try {
      await client.close();
    } finally {
      try {
        await resource?.dispose();
      } finally {
        await fixture.destroy();
      }
    }
  });

  it.each([
    'relaxed',
    'favorite',
    'strict',
  ] as const)('matches every complete frozen %s ordered ranking and score', async (quality) => {
    for (const entry of references.filter((reference) => reference.quality === quality)) {
      const query = referenceQuery(entry.body.query);
      const reference = await client.search({
        index: fixture.options.wallpaperIndex,
        body: { ...entry.body, query: { bool: { ...query.bool, filter: filters } } },
      });
      expect(reference.body.timed_out).toBe(false);
      expect(reference.body._shards.failed).toBe(0);
      const expected = reference.body.hits.hits.map(
        (hit: { fields: { wallpaperId: string[] }; _score: number }) => ({
          id: hit.fields.wallpaperId[0],
          score: hit._score,
        })
      );
      const actual = await Effect.runPromise(
        resource.adapter.read.search(selection(entry.ranking))
      );
      expect(
        actual.entries.map((hit) => ({ id: hit.wallpaper.wallpaperId, score: hit.cursor[0] })),
        entry.name
      ).toEqual(expected);
      expect(actual.total, entry.name).toBe(expected.length);
      expect(expected.some((hit: { id: string }) => hit.id === 'zero-score')).toBe(true);
      expect(
        expected.some(
          (hit: { id: string }) =>
            hit.id.startsWith('outside') ||
            ['incomplete', 'incompatible', 'missing-contributor'].includes(hit.id)
        )
      ).toBe(false);
    }
  });
  it('pages an unchanged global ranking in either direction with stable score ties and near ties', async () => {
    const color = references.find(
      (reference) => reference.name === 'hex-#ff0000-vibe' && reference.quality === 'favorite'
    )?.ranking;
    if (!color) throw new Error('Missing favorite reference');
    const full = await Effect.runPromise(resource.adapter.read.search(selection(color)));
    const all: typeof full.entries = [];
    let after: SearchSelection['searchAfter'];
    while (true) {
      const page = await Effect.runPromise(
        resource.adapter.read.search({ ...selection(color), size: 3, searchAfter: after })
      );
      all.push(...page.entries);
      if (page.entries.length < 3) break;
      after = page.entries.at(-1)?.cursor;
    }
    expect(all).toEqual(full.entries);
    expect(all.findIndex((hit) => hit.wallpaper.wallpaperId === 'near-b')).toBeLessThan(
      all.findIndex((hit) => hit.wallpaper.wallpaperId === 'near-a')
    );
    expect(all.findIndex((hit) => hit.wallpaper.wallpaperId === 'tie-a')).toBeLessThan(
      all.findIndex((hit) => hit.wallpaper.wallpaperId === 'tie-z')
    );
    const backward: typeof full.entries = [];
    let before: SearchSelection['searchAfter'];
    while (true) {
      const page = await Effect.runPromise(
        resource.adapter.read.search({
          ...selection(color),
          size: 3,
          sortOrder: 'asc',
          searchAfter: before,
        })
      );
      backward.push(...page.entries);
      if (page.entries.length < 3) break;
      before = page.entries.at(-1)?.cursor;
    }
    expect(backward.reverse()).toEqual(full.entries);
  });
  it('rejects a ready bank missing a requested utility', async () => {
    const color = references.find((reference) => reference.ranking.utilities.length > 1)?.ranking;
    const missing = color?.utilities.at(-1)?.key;
    if (!color || !missing) throw new Error('Expected a multiple-target ranking fixture');
    const utilities = Object.fromEntries(
      Object.keys(utilitiesReference.cases[0].utilities)
        .filter((key) => key !== missing)
        .map((key) => [key, 0])
    );
    const id = 'missing-requested-utility';
    try {
      await client.index({
        index: fixture.options.wallpaperIndex,
        id,
        refresh: true,
        body: {
          wallpaperId: id,
          userId: 'ranking',
          variants: [variant],
          uploadedAt: timestamp,
          updatedAt: timestamp,
          colorReady: COLOR_UTILITY_VERSION,
          utilities,
        },
      });
      expect(
        await Effect.runPromise(Effect.flip(resource.adapter.read.search(selection(color))))
      ).toMatchObject({ _tag: 'CatalogueUnavailable' });
    } finally {
      await client.delete({ index: fixture.options.wallpaperIndex, id, refresh: true });
    }
  });
  describe('Malformed ranking responses', () => {
    let fault: string | undefined;
    let firstHit: unknown;
    let proxied: Awaited<ReturnType<typeof acquireSearchFixture>> | undefined;
    const proxy = createServer((incoming, outgoing) => {
      const requestChunks: Buffer[] = [];
      let hasCursor = false;
      incoming.on('data', (chunk) => requestChunks.push(Buffer.from(chunk)));
      incoming.on('end', () => {
        if (incoming.url?.includes('/_search'))
          hasCursor =
            JSON.parse(Buffer.concat(requestChunks).toString()).search_after !== undefined;
      });
      const forwarded = request(
        new URL(incoming.url ?? '/', fixture.options.url),
        { method: incoming.method, headers: incoming.headers },
        (response) => {
          if (incoming.url?.includes('/_search')) {
            const chunks: Buffer[] = [];
            response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
            response.on('end', () => {
              const body = JSON.parse(Buffer.concat(chunks).toString());
              if (fault === undefined) firstHit = body.hits.hits[0];
              else {
                if (fault === 'timeout') body.timed_out = true;
                if (fault === 'shards') body._shards.failed = 1;
                if (fault === 'missing-id') delete body.hits.hits[0].fields.wallpaperId;
                if (fault === 'duplicate-id') body.hits.hits.push(body.hits.hits[0]);
                if (fault === 'score') body.hits.hits[0]._score = -1;
                if (fault === 'score-and-sort') {
                  const changed = body.hits.hits[0]._score + 0.01;
                  body.hits.hits[0]._score = changed;
                  body.hits.hits[0].sort[0] = changed;
                }
                if (fault === 'utility-above-one') {
                  const key = references[0].ranking.utilities[0].key;
                  body.hits.hits[0].fields[`utilities.${key}`] = [2];
                  body.hits.hits[0]._score = 2;
                  body.hits.hits[0].sort[0] = 2;
                }
                if (fault.includes('wrong-profile'))
                  body.hits.hits[0]._source.userId = 'outside-profile';
                if (fault.includes('split-variants'))
                  body.hits.hits[0]._source.variants = [
                    { ...variant, height: 720 },
                    { ...variant, width: 800 },
                  ];
                if (fault === 'sort') body.hits.hits[0].sort[1] = 'different';
                if (fault.startsWith('order')) body.hits.hits.reverse();
                if (fault.startsWith('stale')) body.hits.hits[0] = firstHit;
                if (fault.includes('cursor') && hasCursor) {
                  if (fault.includes('interior')) body.hits.hits.splice(1, 1);
                  if (fault.includes('terminal')) body.hits.hits.pop();
                  if (fault.includes('empty')) body.hits.hits = [];
                }
                if (fault === 'total') body.hits.total.relation = 'gte';
                if (fault === 'truncated') body.hits.hits.pop();
              }
              outgoing.writeHead(response.statusCode ?? 500, {
                'content-type': 'application/json',
              });
              outgoing.end(JSON.stringify(body));
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
    beforeAll(async () => {
      proxy.listen(0, '127.0.0.1');
      await once(proxy, 'listening');
      const address = proxy.address();
      if (address === null || typeof address === 'string') throw new Error('Expected TCP listener');
      proxied = await acquireSearchFixture({
        ...fixture.options,
        url: `http://127.0.0.1:${address.port}`,
      });
    });
    afterAll(async () => {
      try {
        await proxied?.dispose();
      } finally {
        proxy.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          proxy.close((error) => (error ? reject(error) : resolve()))
        );
      }
    });
    it.each([
      'timeout',
      'shards',
      'missing-id',
      'duplicate-id',
      'score',
      'score-and-sort',
      'utility-above-one',
      'wrong-profile',
      'split-variants',
      'sort',
      'order',
      'order-asc',
      'stale',
      'stale-asc',
      'cursor-interior-final',
      'cursor-interior-final-asc',
      'cursor-terminal-final',
      'cursor-terminal-final-asc',
      'cursor-interior-full',
      'cursor-interior-full-asc',
      'cursor-terminal-full',
      'cursor-terminal-full-asc',
      'cursor-empty',
      'cursor-empty-asc',
      'total',
      'truncated',
    ] as const)('rejects an incomplete or malformed %s ranking', async (selectedFault) => {
      if (!proxied) throw new Error('Expected an acquired proxy fixture');
      const orderedSelection: SearchSelection = {
        ...selection(),
        sortOrder: selectedFault.endsWith('-asc') ? 'asc' : 'desc',
      };
      const full = await Effect.runPromise(resource.adapter.read.search(orderedSelection));
      try {
        expect(
          (await Effect.runPromise(proxied.adapter.read.search(orderedSelection))).entries.length
        ).toBe(12);
        fault = selectedFault;
        const cursor = full.entries[selectedFault.startsWith('cursor') ? 6 : 3]?.cursor;
        if (!cursor) throw new Error('Expected a complete ranking fixture');
        const requested =
          selectedFault.startsWith('stale') || selectedFault.startsWith('cursor')
            ? {
                ...orderedSelection,
                size: selectedFault.includes('final') ? 6 : 3,
                searchAfter: cursor,
              }
            : orderedSelection;
        expect(
          await Effect.runPromise(Effect.flip(proxied.adapter.read.search(requested)))
        ).toMatchObject({ _tag: 'CatalogueUnavailable' });
      } finally {
        fault = undefined;
        firstHit = undefined;
      }
    });

    it.each([
      ['interior', 'desc'],
      ['terminal', 'desc'],
      ['empty', 'desc'],
      ['interior', 'asc'],
      ['terminal', 'asc'],
      ['empty', 'asc'],
    ] as const)('rejects an incomplete non-color %s cursor page in %s order', async (omission, sortOrder) => {
      if (!proxied) throw new Error('Expected an acquired proxy fixture');
      const uncolored: SearchSelection = {
        profileId: 'ranking',
        variantFilters: { width: 1920, height: 1080 },
        size: 100,
        sortOrder,
      };
      const full = await Effect.runPromise(resource.adapter.read.search(uncolored));
      const cursor = full.entries.at(-5)?.cursor;
      if (!cursor) throw new Error('Expected a complete non-color fixture');
      const requested = { ...uncolored, size: 6, searchAfter: cursor };
      expect(
        (await Effect.runPromise(proxied.adapter.read.search(requested))).entries
      ).toHaveLength(4);
      try {
        fault = `non-color-cursor-${omission}`;
        expect(
          await Effect.runPromise(Effect.flip(proxied.adapter.read.search(requested)))
        ).toMatchObject({ _tag: 'CatalogueUnavailable' });
      } finally {
        fault = undefined;
        firstHit = undefined;
      }
    });

    it.each([
      'wrong-profile',
      'split-variants',
    ] as const)('rejects a non-color hit with %s despite a matching ID and cursor', async (selectedFault) => {
      if (!proxied) throw new Error('Expected an acquired proxy fixture');
      const uncolored: SearchSelection = {
        profileId: 'ranking',
        variantFilters: { width: 1920, height: 1080 },
        size: 100,
        sortOrder: 'asc',
      };
      try {
        fault = selectedFault;
        expect(
          await Effect.runPromise(Effect.flip(proxied.adapter.read.search(uncolored)))
        ).toMatchObject({ _tag: 'CatalogueUnavailable' });
      } finally {
        fault = undefined;
        firstHit = undefined;
      }
    });
  });
});

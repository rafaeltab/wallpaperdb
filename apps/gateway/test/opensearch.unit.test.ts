import { it as effectIt } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import { openSearchLayer } from '../src/adapters/opensearch/index.js';
import {
  json,
  wallpaperMapping,
  withSearchEndpoint,
  withControlledSearch,
} from './helpers/controlled-search.js';

describe('OpenSearch controlled HTTP contracts', () => {
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
    const mapping = wallpaperMapping();
    const supplied = {
      ...mapping,
      ...(field === '_source'
        ? { _source: { ...mapping._source, ...replacement } }
        : {
            properties: {
              ...mapping.properties,
              [field]: { ...mapping.properties[field], ...replacement },
            },
          }),
    };
    await withSearchEndpoint(
      (_request, response) => json(response, { error: 'Unexpected request' }, 500),
      async (options) => {
        const result = await Effect.runPromise(
          Layer.build(openSearchLayer(options)).pipe(Effect.scoped, Effect.result)
        );
        expect(result._tag).toBe('Failure');
        if (result._tag === 'Failure') {
          expect(result.failure.diagnostic).toEqual({
            dependency: 'opensearch',
            operation: 'inspect-index',
            code: 'IncompatibleWallpaperMapping',
            index: 'wallpapers',
            remediation:
              'Use a fresh OPENSEARCH_INDEX with the current wallpaper mapping. Preserve the old index and review the service upgrade guide before rebuilding catalogue data.',
          });
          expect(result.failure.cause).toBeInstanceOf(Error);
        }
      },
      supplied
    );
  });
  it('treats malformed persisted data as unavailable rather than asserting it is a wallpaper', async () => {
    const source = { wallpaperId: 'malformed', userId: 'malformed' };
    await withControlledSearch(
      (request, response) =>
        json(
          response,
          request.url?.includes('/_search')
            ? {
                hits: {
                  total: { value: 1 },
                  hits: [
                    {
                      _id: 'malformed',
                      _index: 'wallpapers',
                      _source: source,
                      _score: null,
                      sort: ['malformed'],
                    },
                  ],
                },
              }
            : { _source: source }
        ),
      async (adapter) => {
        expect(
          await Effect.runPromise(Effect.flip(adapter.read.wallpaper('malformed')))
        ).toMatchObject({ _tag: 'CatalogueUnavailable', cause: { _tag: 'SchemaError' } });
        expect(
          await Effect.runPromise(
            Effect.flip(adapter.read.search({ profileId: 'malformed', size: 10, sortOrder: 'asc' }))
          )
        ).toMatchObject({ _tag: 'CatalogueUnavailable', cause: { _tag: 'SchemaError' } });
      }
    );
  });
  it('rejects impossible calendar dates in stored timestamps', async () => {
    let uploadedAt = '';
    await withControlledSearch(
      (_request, response) =>
        json(response, {
          _source: {
            wallpaperId: 'invalid-calendar',
            userId: 'owner',
            variants: [],
            uploadedAt,
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        }),
      async (adapter) => {
        for (uploadedAt of [
          '2026-02-30T00:00:00.000Z',
          '1900-02-29T00:00:00Z',
          '2026-04-31T00:00:00Z',
        ]) {
          expect(
            await Effect.runPromise(Effect.flip(adapter.read.wallpaper('invalid-calendar')))
          ).toMatchObject({ _tag: 'CatalogueUnavailable', cause: { _tag: 'SchemaError' } });
        }
      }
    );
  });
});

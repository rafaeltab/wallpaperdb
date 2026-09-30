import { DateTime, Option, Schema } from 'effect';
import { COLOR_UTILITY_VERSION } from '../../capabilities/catalogue/index.js';
import type {
  ColorRanking,
  CursorValue,
  SearchSelection,
} from '../../capabilities/catalogue/index.js';

export const timestamp = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?Z$/),
  Schema.makeFilter(
    (value) => {
      const parsed = DateTime.make(value);
      return (
        Option.isSome(parsed) &&
        DateTime.formatIso(parsed.value).slice(0, 10) === value.slice(0, 10)
      );
    },
    { expected: 'a valid UTC calendar timestamp' }
  )
);
const positiveInteger = Schema.Int.check(Schema.isGreaterThan(0));
const nonnegativeInteger = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const variantDocument = Schema.Struct({
  width: positiveInteger,
  height: positiveInteger,
  aspectRatio: Schema.Finite.check(Schema.isGreaterThan(0)),
  format: Schema.NonEmptyString,
  fileSizeBytes: nonnegativeInteger,
  createdAt: timestamp,
});
const wallpaperDocument = Schema.Struct({
  wallpaperId: Schema.NonEmptyString,
  userId: Schema.NonEmptyString,
  variants: Schema.Array(variantDocument),
  uploadedAt: timestamp,
  updatedAt: timestamp,
});
const profileDocument = Schema.Struct({
  id: Schema.NonEmptyString,
  displayName: Schema.NonEmptyString,
  handle: Schema.NonEmptyString,
  claimGeneration: positiveInteger,
  aliases: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        handle: Schema.NonEmptyString,
        claimGeneration: positiveInteger,
        createdAt: Schema.optionalKey(timestamp),
        expiresAt: Schema.optionalKey(Schema.NullOr(timestamp)),
      })
    )
  ),
  biographyMarkdown: Schema.String,
  pictureAssetId: Schema.NullOr(Schema.NonEmptyString),
  version: positiveInteger,
  createdAt: timestamp,
  updatedAt: timestamp,
});
export const wallpaperResponse = Schema.decodeUnknownEffect(
  Schema.Struct({ _source: wallpaperDocument })
);
export const profileResponse = Schema.decodeUnknownEffect(
  Schema.Struct({ _source: profileDocument })
);
export const partialWallpaperResponse = Schema.decodeUnknownEffect(
  Schema.Struct({ _source: Schema.Struct({ userId: Schema.optional(Schema.Unknown) }) })
);
export const profileBatchResponse = Schema.decodeUnknownEffect(
  Schema.Struct({
    docs: Schema.Array(
      Schema.Union([
        Schema.Struct({ found: Schema.Literal(false) }),
        Schema.Struct({ found: Schema.Literal(true), _source: profileDocument }),
      ])
    ),
  })
);
export const profileSearchResponse = Schema.decodeUnknownEffect(
  Schema.Struct({
    hits: Schema.Struct({
      hits: Schema.Array(
        Schema.Struct({
          _source: profileDocument,
          sort: Schema.Tuple([positiveInteger]),
        })
      ),
    }),
  })
);
export const profileDiscoveryResponse = Schema.decodeUnknownEffect(
  Schema.Struct({
    hits: Schema.Struct({
      hits: Schema.Array(
        Schema.Struct({
          _source: profileDocument,
          sort: Schema.Tuple([
            positiveInteger.check(Schema.isLessThanOrEqualTo(6)),
            Schema.NonEmptyString,
          ]),
        })
      ),
    }),
  })
);
const wallpaperHit = Schema.Struct({
  _id: Schema.NonEmptyString,
  _index: Schema.NonEmptyString,
  _source: Schema.Struct({
    ...wallpaperDocument.fields,
    colorReady: Schema.optionalKey(Schema.String),
  }),
  _score: Schema.NullOr(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
  fields: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.Array(Schema.Union([Schema.String, Schema.Finite])))
  ),
  sort: Schema.Array(Schema.Union([Schema.String, Schema.Finite])),
});
function matchesColorScore(hit: typeof wallpaperHit.Type, color: ColorRanking): boolean {
  let expected = 0;
  for (const { key, multiplicity } of color.utilities) {
    const values = hit.fields?.[`utilities.${key}`];
    const value = values?.[0];
    if (values?.length !== 1 || typeof value !== 'number' || value < 0 || value > 1) return false;
    expected += Math.fround(Math.fround(value) * Math.fround(multiplicity / color.targetCount));
  }
  // Bound float32 rounding from the factor, clause scores, and accumulation.
  const tolerance = expected * (color.utilities.length + 2) * 2 ** -24;
  return hit._score !== null && Math.abs(hit._score - expected) <= tolerance;
}
function matchesMetadata(hit: typeof wallpaperHit.Type, selection: SearchSelection): boolean {
  if (selection.profileId && hit._source.userId !== selection.profileId) return false;
  const filters = selection.variantFilters;
  if (
    !filters ||
    [filters.width, filters.height, filters.aspectRatio, filters.format].every(
      (value) => value === undefined
    )
  )
    return true;
  return hit._source.variants.some(
    (variant) =>
      (filters.width === undefined || variant.width === filters.width) &&
      (filters.height === undefined || variant.height === filters.height) &&
      (filters.aspectRatio === undefined ||
        Math.fround(variant.aspectRatio) === Math.fround(filters.aspectRatio)) &&
      (filters.format === undefined || variant.format === filters.format)
  );
}
function validHit(hit: typeof wallpaperHit.Type, selection: SearchSelection, index: string) {
  const id = hit._source.wallpaperId;
  if (hit._id !== id || hit._index !== index || !matchesMetadata(hit, selection)) return false;
  if (!selection.color) return hit.sort.length === 1 && hit.sort[0] === id;
  if (hit._source.colorReady !== COLOR_UTILITY_VERSION) return false;
  const ids = hit.fields?.wallpaperId;
  return (
    ids?.length === 1 &&
    ids[0] === id &&
    hit._score !== null &&
    hit.sort.length === 2 &&
    hit.sort[0] === hit._score &&
    hit.sort[1] === id &&
    matchesColorScore(hit, selection.color)
  );
}
export function followsSearchCursor(
  cursor: readonly CursorValue[],
  previous: readonly CursorValue[],
  selection: SearchSelection
): boolean {
  const value = cursor[0];
  const before = previous[0];
  const direction = selection.sortOrder === 'asc' ? 1 : -1;
  if (typeof value === 'number' && typeof before === 'number' && value !== before)
    return (value - before) * direction > 0;
  if (typeof value === 'string' && typeof before === 'string')
    return Buffer.compare(Buffer.from(value), Buffer.from(before)) * direction > 0;
  const id = cursor[1];
  const previousId = previous[1];
  return (
    selection.color !== undefined &&
    value === before &&
    typeof id === 'string' &&
    typeof previousId === 'string' &&
    Buffer.compare(Buffer.from(id), Buffer.from(previousId)) * -direction > 0
  );
}
export function wallpaperSearchResponse(selection: SearchSelection, index: string) {
  return Schema.decodeUnknownEffect(
    Schema.Struct({
      timed_out: Schema.Literal(false),
      _shards: Schema.Struct({
        total: positiveInteger,
        successful: positiveInteger,
        failed: Schema.Literal(0),
      }).check(
        Schema.makeFilter((shards) => shards.total === shards.successful, {
          expected: 'all search shards succeeded',
        })
      ),
      hits: Schema.Struct({
        hits: Schema.Array(
          wallpaperHit.check(
            Schema.makeFilter((hit) => validHit(hit, selection, index), {
              expected: 'a consistent wallpaper ID, metadata eligibility, score and cursor',
            })
          )
        ),
        total: Schema.Struct({ value: nonnegativeInteger, relation: Schema.Literal('eq') }),
      }),
    }).check(
      Schema.makeFilter(
        ({ hits }) => {
          const expected = Math.min(selection.size, hits.total.value);
          const count = hits.hits.length;
          return (
            count <= expected &&
            (selection.searchAfter !== undefined || count === expected) &&
            new Set(hits.hits.map((hit) => hit._id)).size === count &&
            hits.hits.every((hit, position) => {
              const previous =
                position === 0 ? selection.searchAfter : hits.hits[position - 1]?.sort;
              return previous === undefined || followsSearchCursor(hit.sort, previous, selection);
            })
          );
        },
        { expected: 'a complete search page with unique wallpaper IDs in cursor order' }
      )
    )
  );
}
export const updateResponse = Schema.decodeUnknownEffect(
  Schema.Struct({ result: Schema.Literals(['created', 'updated', 'noop']) })
);
export const storageError = Schema.decodeUnknownOption(
  Schema.Struct({
    meta: Schema.Struct({
      statusCode: Schema.Number,
      body: Schema.optional(
        Schema.Struct({ error: Schema.optional(Schema.Struct({ type: Schema.String })) })
      ),
    }),
  })
);
export function toWallpaper(document: typeof wallpaperDocument.Type) {
  return {
    wallpaperId: document.wallpaperId,
    profileId: document.userId,
    variants: [...document.variants],
    uploadedAt: document.uploadedAt,
    updatedAt: document.updatedAt,
  };
}

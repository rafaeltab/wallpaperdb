import { DateTime, Option, Schema } from 'effect';

const timestamp = Schema.String.check(
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
const variant = Schema.Struct({
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
  variants: Schema.Array(variant),
  uploadedAt: timestamp,
  updatedAt: timestamp,
});
const profileDocument = Schema.Struct({
  id: Schema.NonEmptyString,
  displayName: Schema.NonEmptyString,
  handle: Schema.NonEmptyString,
  claimGeneration: positiveInteger,
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
    hits: Schema.Struct({ hits: Schema.Array(Schema.Struct({ _source: profileDocument })) }),
  })
);
export const wallpaperSearchResponse = Schema.decodeUnknownEffect(
  Schema.Struct({
    hits: Schema.Struct({
      hits: Schema.Array(
        Schema.Struct({
          _source: wallpaperDocument,
          sort: Schema.Array(Schema.Union([Schema.String, Schema.Finite])),
        })
      ),
      total: Schema.Struct({ value: nonnegativeInteger }),
    }),
  })
);
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
export function toWallpaper({ userId, variants, ...wallpaper }: typeof wallpaperDocument.Type) {
  return { ...wallpaper, profileId: userId, variants: [...variants] };
}

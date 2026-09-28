import { Effect, Layer, Schema } from 'effect';
import { buildColorVector, validateColors } from './colors.js';
import type {
  CatalogueConfig,
  InvalidSearch,
  ProfileSearchOutcome,
  SearchOutcome,
  SearchProfiles,
  SearchWallpapers,
} from './contract.js';
import {
  Catalogue,
  CatalogueCursors,
  CatalogueRead,
  type CatalogueUnavailable,
} from './contract.js';

const pageSizeSchema = Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(100));

const validPageSizes = Schema.is(
  Schema.Struct({ first: Schema.optional(pageSizeSchema), last: Schema.optional(pageSizeSchema) })
);

/** Catalogue pagination defaults to 10 and accepts at most 100 results per page. */
export function resolvePageSize(
  query: Pick<SearchWallpapers, 'first' | 'last'>
): number | InvalidSearch {
  return validPageSizes(query)
    ? (query.first ?? query.last ?? 10)
    : { _tag: 'InvalidSearch', reason: 'Page size must be an integer between 1 and 100' };
}

const validProfilePageSize = Schema.is(
  Schema.Struct({
    first: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
  })
);

const validProfileQuery = Schema.is(
  Schema.NonEmptyString.check(
    Schema.makeFilter((value) => [...value].length <= 100, {
      expected: 'at most 100 Unicode characters',
    })
  )
);

const validProfileCursorInput = Schema.is(Schema.NonEmptyString.check(Schema.isMaxLength(2048)));

const validWallpaperCursor = Schema.is(Schema.Tuple([Schema.NonEmptyString]));

const validColorWallpaperCursor = Schema.is(Schema.Tuple([Schema.Finite, Schema.NonEmptyString]));

const validProfileCursor = Schema.is(
  Schema.Tuple([
    Schema.Literal('profiles'),
    Schema.String,
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 6 })),
    Schema.NonEmptyString,
  ])
);

/** Profile discovery defaults to 10 results and accepts at most 50 per page. */
export function resolveProfilePageSize(
  query: Pick<SearchProfiles, 'first'>
): number | InvalidSearch {
  return validProfilePageSize(query)
    ? (query.first ?? 10)
    : { _tag: 'InvalidSearch', reason: 'Profile search first must be between 1 and 50' };
}

export function catalogueLayer(
  config: CatalogueConfig
): Layer.Layer<Catalogue, never, CatalogueRead | CatalogueCursors> {
  return Layer.effect(
    Catalogue,
    Effect.gen(function* () {
      const read = yield* CatalogueRead;
      const cursors = yield* CatalogueCursors;
      const search = Effect.fn('catalogue.search')(function* (
        query: SearchWallpapers
      ): Effect.fn.Return<SearchOutcome, CatalogueUnavailable> {
        const limit = resolvePageSize(query);
        if (typeof limit !== 'number') return limit;
        if (query.colors) {
          const invalid = validateColors(query.colors);
          if (invalid) return { _tag: 'InvalidSearch', reason: invalid };
        }
        const cursor = query.after || query.before;
        const position = cursor ? yield* cursors.decode(cursor) : undefined;
        if (position?._tag === 'InvalidCursor') return position;
        if (
          position &&
          !(query.colors
            ? validColorWallpaperCursor(position.values)
            : validWallpaperCursor(position.values))
        )
          return { _tag: 'InvalidCursor' };
        const backward = query.last !== undefined && query.before !== undefined;
        const colorVector = query.colors
          ? buildColorVector(query.colors, config.colorSpreadStrategy)
          : undefined;
        const result = yield* read.search({
          size: limit + 1,
          sortOrder: colorVector ? (backward ? 'asc' : 'desc') : backward ? 'desc' : 'asc',
          ...(query.profileId !== undefined ? { profileId: query.profileId } : {}),
          ...(query.variants !== undefined ? { variantFilters: query.variants } : {}),
          ...(colorVector ? { colorVector } : {}),
          ...(position ? { searchAfter: position.values } : {}),
        });
        const hasMore = result.entries.length > limit;
        const entries = result.entries.slice(0, limit);
        if (backward) entries.reverse();
        const first = entries[0];
        const last = entries.at(-1);
        const startCursor = first ? yield* cursors.encode(first.cursor) : null;
        const endCursor = last ? yield* cursors.encode(last.cursor) : null;
        return {
          _tag: 'Found',
          value: {
            wallpapers: entries.map((entry) => entry.wallpaper),
            pageInfo: {
              hasNextPage: backward ? entries.length > 0 : hasMore,
              hasPreviousPage: backward ? hasMore : Boolean(query.after),
              startCursor,
              endCursor,
            },
          },
        };
      });
      const searchProfiles = Effect.fn('catalogue.searchProfiles')(function* (
        input: SearchProfiles
      ): Effect.fn.Return<ProfileSearchOutcome, CatalogueUnavailable> {
        const query = input.query.trim().replace(/^@/, '').trim().toLowerCase();
        if (!validProfileQuery(query))
          return {
            _tag: 'InvalidSearch',
            reason: 'Profile search query must contain 1 to 100 characters',
          };
        const limit = resolveProfilePageSize(input);
        if (typeof limit !== 'number') return limit;
        if (input.after !== undefined && !validProfileCursorInput(input.after))
          return { _tag: 'InvalidCursor' };
        const position = input.after !== undefined ? yield* cursors.decode(input.after) : undefined;
        if (position?._tag === 'InvalidCursor') return position;
        if (position && (!validProfileCursor(position.values) || position.values[1] !== query))
          return { _tag: 'InvalidCursor' };
        const result = yield* read.searchProfiles({
          query,
          size: limit + 1,
          ...(position ? { searchAfter: position.values.slice(2) } : {}),
        });
        const entries = result.entries.slice(0, limit);
        const first = entries[0];
        const last = entries.at(-1);
        const startCursor = first
          ? yield* cursors.encode(['profiles', query, ...first.cursor])
          : null;
        const endCursor = last ? yield* cursors.encode(['profiles', query, ...last.cursor]) : null;
        return {
          _tag: 'Found',
          value: {
            profiles: entries.map((entry) => entry.profile),
            pageInfo: {
              hasNextPage: result.entries.length > limit,
              hasPreviousPage: input.after !== undefined,
              startCursor,
              endCursor,
            },
          },
        };
      });
      return Catalogue.of({
        search,
        searchProfiles,
        wallpaper: Effect.fn('catalogue.wallpaper')((id: string) => read.wallpaper(id)),
        profile: Effect.fn('catalogue.profile')((id: string) => read.profile(id)),
        profileByHandle: Effect.fn('catalogue.profileByHandle')(function* (handle: string) {
          const profile = yield* read.profileByHandle(handle.toLowerCase());
          return profile
            ? {
                profile,
                requestedHandle: handle,
                isAlias: profile.handle !== handle.toLowerCase(),
                canonicalHandle: profile.handle,
              }
            : null;
        }),
        profiles: Effect.fn('catalogue.profiles')((ids: string[]) => read.profiles(ids)),
      });
    })
  );
}

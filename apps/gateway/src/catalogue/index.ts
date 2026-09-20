import { Context, Effect, Layer, Schema } from 'effect';
import { buildColorVector, validateColors } from './colors.js';

export interface Variant {
  width: number;
  height: number;
  aspectRatio: number;
  format: string;
  fileSizeBytes: number;
  createdAt: string;
}
export interface Wallpaper {
  wallpaperId: string;
  profileId: string;
  variants: Variant[];
  uploadedAt: string;
  updatedAt: string;
}
/** Gateway-owned interpretation of a public Profile snapshot. */
export interface Profile {
  id: string;
  handle: string;
  displayName: string;
  biographyMarkdown: string;
  pictureAssetId: string | null;
  version: number;
  claimGeneration: number;
  createdAt: string;
  updatedAt: string;
}
export interface ColorPreference {
  color: string;
  amount: number;
  spread?: number;
}
export interface VariantSelection {
  width?: number;
  height?: number;
  aspectRatio?: number;
  format?: string;
}
export interface SearchWallpapers {
  profileId?: string;
  variants?: VariantSelection;
  colors?: ColorPreference[];
  first?: number;
  after?: string;
  last?: number;
  before?: string;
}
export interface WallpaperPage {
  wallpapers: Wallpaper[];
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string | null;
    endCursor: string | null;
  };
}
export type CursorValue = string | number;
export class CatalogueUnavailable extends Schema.TaggedError<CatalogueUnavailable>()(
  'CatalogueUnavailable',
  { cause: Schema.Defect() }
) {}
export type InvalidSearch = { readonly _tag: 'InvalidSearch'; readonly reason: string };
export type InvalidCursor = { readonly _tag: 'InvalidCursor' };
export type SearchOutcome =
  | { readonly _tag: 'Found'; readonly value: WallpaperPage }
  | InvalidSearch
  | InvalidCursor;
export interface SearchSelection {
  profileId?: string;
  variantFilters?: VariantSelection;
  colorVector?: number[];
  searchAfter?: CursorValue[];
  size: number;
  sortOrder: 'asc' | 'desc';
}
export interface SearchBatch {
  entries: Array<{ wallpaper: Wallpaper; cursor: CursorValue[] }>;
  total: number;
}
/**
 * Read-only projected catalogue. Search entries are ordered by the requested order,
 * with stable cursor values for every entry. Variant predicates match one variant.
 * Missing records are null; batches preserve input order, duplicates and null slots.
 * Unavailability includes malformed persisted data and never exposes vendor errors.
 */
export interface CatalogueRead {
  search(selection: SearchSelection): Effect.Effect<SearchBatch, CatalogueUnavailable>;
  wallpaper(id: string): Effect.Effect<Wallpaper | null, CatalogueUnavailable>;
  profile(id: string): Effect.Effect<Profile | null, CatalogueUnavailable>;
  profileByHandle(handle: string): Effect.Effect<Profile | null, CatalogueUnavailable>;
  profiles(ids: string[]): Effect.Effect<Array<Profile | null>, CatalogueUnavailable>;
}
export const CatalogueRead = Context.Service<CatalogueRead>('wallpaperdb.gateway.catalogue.read');
/** Opaque cursor encoding preserves values; decoding rejects tampering and expiration. */
export interface CatalogueCursors {
  encode(values: CursorValue[]): Effect.Effect<string>;
  decode(
    cursor: string
  ): Effect.Effect<{ readonly _tag: 'Decoded'; readonly values: CursorValue[] } | InvalidCursor>;
}
export const CatalogueCursors = Context.Service<CatalogueCursors>(
  'wallpaperdb.gateway.catalogue.cursors'
);
/** All catalogue reads are public. This capability exposes no protected writes. */
export interface Catalogue {
  search(query: SearchWallpapers): Effect.Effect<SearchOutcome, CatalogueUnavailable>;
  wallpaper(id: string): Effect.Effect<Wallpaper | null, CatalogueUnavailable>;
  profile(id: string): Effect.Effect<Profile | null, CatalogueUnavailable>;
  profileByHandle(handle: string): Effect.Effect<Profile | null, CatalogueUnavailable>;
  profiles(ids: string[]): Effect.Effect<Array<Profile | null>, CatalogueUnavailable>;
}
export const Catalogue = Context.Service<Catalogue>('wallpaperdb.gateway.catalogue');
export interface CatalogueConfig {
  colorSpreadStrategy: 'linear' | 'exponential' | 'exact';
}

const pageSizeSchema = Schema.Int.check(Schema.isGreaterThan(0));

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
        const limit = query.first ?? query.last ?? 10;
        if (!Schema.is(pageSizeSchema)(limit))
          return { _tag: 'InvalidSearch', reason: 'Page size must be a positive integer' };
        if (query.colors) {
          const invalid = validateColors(query.colors);
          if (invalid) return { _tag: 'InvalidSearch', reason: invalid };
        }
        const cursor = query.after || query.before;
        const position = cursor ? yield* cursors.decode(cursor) : undefined;
        if (position?._tag === 'InvalidCursor') return position;
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
      return Catalogue.of({
        search,
        wallpaper: Effect.fn('catalogue.wallpaper')((id: string) => read.wallpaper(id)),
        profile: Effect.fn('catalogue.profile')((id: string) => read.profile(id)),
        profileByHandle: Effect.fn('catalogue.profileByHandle')((handle: string) =>
          read.profileByHandle(handle.toLowerCase())
        ),
        profiles: Effect.fn('catalogue.profiles')((ids: string[]) => read.profiles(ids)),
      });
    })
  );
}

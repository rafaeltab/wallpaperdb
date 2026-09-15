import { Effect } from 'effect';
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
export type ReadOutcome<T> =
  | { readonly _tag: 'Found'; readonly value: T }
  | { readonly _tag: 'Unavailable' };
export type InvalidSearch = { readonly _tag: 'InvalidSearch'; readonly reason: string };
export type InvalidCursor = { readonly _tag: 'InvalidCursor' };
export type SearchOutcome = ReadOutcome<WallpaperPage> | InvalidSearch | InvalidCursor;
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
  search(selection: SearchSelection): Effect.Effect<ReadOutcome<SearchBatch>>;
  wallpaper(id: string): Effect.Effect<ReadOutcome<Wallpaper | null>>;
  profile(id: string): Effect.Effect<ReadOutcome<Profile | null>>;
  profileByHandle(handle: string): Effect.Effect<ReadOutcome<Profile | null>>;
  profiles(ids: string[]): Effect.Effect<ReadOutcome<Array<Profile | null>>>;
}
export const CatalogueRead = Symbol.for('wallpaperdb.gateway.catalogue.read');
/** Opaque cursor encoding preserves values; decoding rejects tampering and expiration. */
export interface CatalogueCursors {
  encode(values: CursorValue[]): Effect.Effect<string>;
  decode(
    cursor: string
  ): Effect.Effect<{ readonly _tag: 'Decoded'; readonly values: CursorValue[] } | InvalidCursor>;
}
export const CatalogueCursors = Symbol.for('wallpaperdb.gateway.catalogue.cursors');
/** All catalogue reads are public. This capability exposes no protected writes. */
export interface Catalogue {
  search(query: SearchWallpapers): Effect.Effect<SearchOutcome>;
  wallpaper(id: string): Effect.Effect<ReadOutcome<Wallpaper | null>>;
  profile(id: string): Effect.Effect<ReadOutcome<Profile | null>>;
  profileByHandle(handle: string): Effect.Effect<ReadOutcome<Profile | null>>;
  profiles(ids: string[]): Effect.Effect<ReadOutcome<Array<Profile | null>>>;
}
export const Catalogue = Symbol.for('wallpaperdb.gateway.catalogue');
export interface CatalogueConfig {
  colorSpreadStrategy: 'linear' | 'exponential' | 'exact';
}

class CatalogueApplication implements Catalogue {
  constructor(
    private readonly read: CatalogueRead,
    private readonly cursors: CatalogueCursors,
    private readonly config: CatalogueConfig
  ) {}

  search(query: SearchWallpapers): Effect.Effect<SearchOutcome> {
    return Effect.gen(this, function* () {
      const limit = query.first ?? query.last ?? 10;
      if (!Number.isSafeInteger(limit) || limit < 1)
        return { _tag: 'InvalidSearch' as const, reason: 'Page size must be a positive integer' };
      if (query.colors) {
        const invalid = validateColors(query.colors);
        if (invalid) return { _tag: 'InvalidSearch' as const, reason: invalid };
      }
      const cursor = query.after || query.before;
      const position = cursor ? yield* this.cursors.decode(cursor) : undefined;
      if (position?._tag === 'InvalidCursor') return position;
      const backward = query.last !== undefined && query.before !== undefined;
      const colorVector = query.colors
        ? buildColorVector(query.colors, this.config.colorSpreadStrategy)
        : undefined;
      const result = yield* this.read.search({
        size: limit + 1,
        sortOrder: colorVector ? (backward ? 'asc' : 'desc') : backward ? 'desc' : 'asc',
        ...(query.profileId !== undefined ? { profileId: query.profileId } : {}),
        ...(query.variants !== undefined ? { variantFilters: query.variants } : {}),
        ...(colorVector ? { colorVector } : {}),
        ...(position ? { searchAfter: position.values } : {}),
      });
      if (result._tag === 'Unavailable') return result;
      const hasMore = result.value.entries.length > limit;
      const entries = result.value.entries.slice(0, limit);
      if (backward) entries.reverse();
      const first = entries[0];
      const last = entries.at(-1);
      const startCursor = first ? yield* this.cursors.encode(first.cursor) : null;
      const endCursor = last ? yield* this.cursors.encode(last.cursor) : null;
      return {
        _tag: 'Found' as const,
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
    }).pipe(Effect.withSpan('catalogue.search'));
  }
  wallpaper(id: string) {
    return this.read.wallpaper(id).pipe(Effect.withSpan('catalogue.wallpaper'));
  }
  profile(id: string) {
    return this.read.profile(id).pipe(Effect.withSpan('catalogue.profile'));
  }
  profileByHandle(handle: string) {
    return this.read
      .profileByHandle(handle.toLowerCase())
      .pipe(Effect.withSpan('catalogue.profileByHandle'));
  }
  profiles(ids: string[]) {
    return this.read.profiles(ids).pipe(Effect.withSpan('catalogue.profiles'));
  }
}
export function createCatalogue(
  read: CatalogueRead,
  cursors: CatalogueCursors,
  config: CatalogueConfig
): Catalogue {
  return new CatalogueApplication(read, cursors, config);
}

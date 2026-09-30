import { Context, type Effect, Schema } from 'effect';

export type ColorQuality = 'relaxed' | 'favorite' | 'strict';

export interface ColorDescriptor {
  readonly version: string;
  readonly sampleCount: number;
  readonly layers: readonly {
    readonly cutoff: number;
    readonly coverage: readonly number[];
    readonly quality: readonly number[];
  }[];
  readonly named: Readonly<Record<string, { readonly coverage: number; readonly quality: number }>>;
}

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
  readonly aliases?: ReadonlyArray<{
    readonly handle: string;
    readonly claimGeneration: number;
    readonly createdAt?: string;
    readonly expiresAt?: string | null;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface HandleResolution {
  profile: Profile;
  requestedHandle: string;
  isAlias: boolean;
  canonicalHandle: string;
}

export interface ColorTarget {
  color?: string;
  name?: string;
  percent?: number;
}

/** Targets contribute independently. Percentages describe the whole image. */
export interface ColorQuery {
  mode?: 'vibe' | 'proportions';
  quality?: ColorQuality;
  targets: ColorTarget[];
}

export interface ColorRanking {
  readonly targetCount: number;
  readonly utilities: ReadonlyArray<{ readonly key: string; readonly multiplicity: number }>;
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
  /** Color ranking accepts one through ten independently scored targets. */
  color?: ColorQuery;
  first?: number;
  after?: string;
  last?: number;
  before?: string;
}

export interface SearchProfiles {
  query: string;
  first?: number;
  after?: string;
}

export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
}

export interface WallpaperPage {
  wallpapers: Wallpaper[];
  pageInfo: PageInfo;
}

export interface ProfilePage {
  profiles: Profile[];
  pageInfo: PageInfo;
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

export type ProfileSearchOutcome =
  | { readonly _tag: 'Found'; readonly value: ProfilePage }
  | InvalidSearch
  | InvalidCursor;

export interface SearchSelection {
  profileId?: string;
  variantFilters?: VariantSelection;
  color?: ColorRanking;
  searchAfter?: CursorValue[];
  size: number;
  sortOrder: 'asc' | 'desc';
}

export interface SearchBatch {
  entries: Array<{ wallpaper: Wallpaper; cursor: CursorValue[] }>;
  total: number;
}

export interface ProfileSearchSelection {
  query: string;
  size: number;
  searchAfter?: CursorValue[];
}

export interface ProfileSearchBatch {
  entries: Array<{ profile: Profile; cursor: CursorValue[] }>;
}

/**
 * Read-only projected catalogue. Search entries are ordered by the requested order,
 * with stable cursor values for every entry. Variant predicates match one variant.
 * Missing records are null; batches preserve input order, duplicates and null slots.
 * Unavailability includes malformed persisted data and never exposes vendor errors.
 * Color search ranks every compatible complete bank after metadata eligibility,
 * including zero scores. Native numeric scores descend, then wallpaper IDs ascend;
 * ascending order reverses both components for backward pagination. IDs come from
 * doc values. Timeouts, shard failures and incomplete responses are unavailable.
 * Profile discovery orders exact current Handles, current prefixes, exact active
 * aliases, alias prefixes, Display name phrase/prefix matches, then fuzzy names.
 * Fixed ranks 6 through 1 use Profile ID ascending to break ties. Biography is excluded.
 * Exact Handle lookup selects the highest generation of that matching claim;
 * current claims win ties. Aliases are active until their exact expiry, or indefinitely
 * without one. Each operation evaluates activity at its read time.
 */
export interface CatalogueRead {
  search(selection: SearchSelection): Effect.Effect<SearchBatch, CatalogueUnavailable>;
  searchProfiles(
    selection: ProfileSearchSelection
  ): Effect.Effect<ProfileSearchBatch, CatalogueUnavailable>;
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
  searchProfiles(query: SearchProfiles): Effect.Effect<ProfileSearchOutcome, CatalogueUnavailable>;
  wallpaper(id: string): Effect.Effect<Wallpaper | null, CatalogueUnavailable>;
  profile(id: string): Effect.Effect<Profile | null, CatalogueUnavailable>;
  profileByHandle(handle: string): Effect.Effect<HandleResolution | null, CatalogueUnavailable>;
  profiles(ids: string[]): Effect.Effect<Array<Profile | null>, CatalogueUnavailable>;
}

export const Catalogue = Context.Service<Catalogue>('wallpaperdb.gateway.catalogue');

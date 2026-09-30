export type {
  CatalogueConfig,
  ColorDescriptor,
  ColorPreference,
  CursorValue,
  HandleResolution,
  InvalidCursor,
  InvalidSearch,
  PageInfo,
  Profile,
  ProfilePage,
  ProfileSearchBatch,
  ProfileSearchOutcome,
  ProfileSearchSelection,
  SearchBatch,
  SearchOutcome,
  SearchProfiles,
  SearchSelection,
  SearchWallpapers,
  Variant,
  VariantSelection,
  Wallpaper,
  WallpaperPage,
} from './contract.js';
export { Catalogue, CatalogueCursors, CatalogueRead, CatalogueUnavailable } from './contract.js';
export { catalogueLayer, resolvePageSize, resolveProfilePageSize } from './implementation.js';
export {
  COLOR_UTILITY_VERSION,
  COLOR_QUALITY_PRESETS,
  colorUtilityKey,
  colorUtilityFields,
  encodeColorUtilities,
} from './color-utilities.js';
export type { ColorQuality } from './color-utilities.js';

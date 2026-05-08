import type { WallpaperFilter } from '@/lib/graphql/types';

export const BROWSE_FORMAT_OPTIONS = [
  { value: 'any', label: 'Any' },
  { value: 'jpeg', label: 'JPEG', mimeType: 'image/jpeg' },
  { value: 'png', label: 'PNG', mimeType: 'image/png' },
  { value: 'webp', label: 'WebP', mimeType: 'image/webp' },
] as const;

export type BrowseFormatValue = Exclude<(typeof BROWSE_FORMAT_OPTIONS)[number]['value'], 'any'>;

export interface BrowseSearchState {
  after?: string;
  format?: BrowseFormatValue;
}

export function parseBrowseSearch(search: Record<string, unknown>): BrowseSearchState {
  return {
    after: typeof search.after === 'string' ? search.after : undefined,
    format: isBrowseFormatValue(search.format) ? search.format : undefined,
  };
}

export function buildWallpaperFilter(format?: BrowseFormatValue): WallpaperFilter | undefined {
  const selectedFormat = BROWSE_FORMAT_OPTIONS.find((option) => option.value === format);

  if (!selectedFormat || !('mimeType' in selectedFormat)) {
    return undefined;
  }

  return {
    variants: {
      format: selectedFormat.mimeType,
    },
  };
}

export function getFormatBadgeLabel(format: BrowseFormatValue): string {
  return `Format: ${getFormatLabel(format)}`;
}

export function getFormatLabel(format: BrowseFormatValue): string {
  return BROWSE_FORMAT_OPTIONS.find((option) => option.value === format)?.label ?? format;
}

function isBrowseFormatValue(value: unknown): value is BrowseFormatValue {
  return value === 'jpeg' || value === 'png' || value === 'webp';
}

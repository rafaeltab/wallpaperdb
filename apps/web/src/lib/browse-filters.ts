import type { WallpaperFilter, WallpaperSort } from '@/lib/graphql/types';

export const BROWSE_FORMAT_OPTIONS = [
  { value: 'any', label: 'Any' },
  { value: 'jpeg', label: 'JPEG', mimeType: 'image/jpeg' },
  { value: 'png', label: 'PNG', mimeType: 'image/png' },
  { value: 'webp', label: 'WebP', mimeType: 'image/webp' },
] as const;

export const BROWSE_ASPECT_RATIO_OPTIONS = [
  { value: 'any', label: 'Any' },
  { value: 'device', label: 'Device' },
  { value: '16-9', label: '16:9', ratio: 16 / 9 },
  { value: '16-10', label: '16:10', ratio: 16 / 10 },
  { value: '4-3', label: '4:3', ratio: 4 / 3 },
  { value: '9-16', label: '9:16', ratio: 9 / 16 },
  { value: '1-1', label: '1:1', ratio: 1 },
  { value: '21-9', label: '21:9', ratio: 21 / 9 },
] as const;

export type BrowseFormatValue = Exclude<(typeof BROWSE_FORMAT_OPTIONS)[number]['value'], 'any'>;
export type BrowseAspectRatioValue = Exclude<
  (typeof BROWSE_ASPECT_RATIO_OPTIONS)[number]['value'],
  'any'
>;
export type BrowseAspectRatioPresetValue = Exclude<BrowseAspectRatioValue, 'device'>;

export interface BrowseSearchState {
  after?: string;
  format?: BrowseFormatValue;
  aspectRatio?: BrowseAspectRatioValue;
  color?: string;
}

export function parseBrowseSearch(search: Record<string, unknown>): BrowseSearchState {
  return {
    after: typeof search.after === 'string' ? search.after : undefined,
    color: normalizeBrowseColorValue(search.color),
    format: isBrowseFormatValue(search.format) ? search.format : undefined,
    aspectRatio: isBrowseAspectRatioValue(search.aspectRatio) ? search.aspectRatio : undefined,
  };
}

export function buildWallpaperFilter(
  format?: BrowseFormatValue,
  aspectRatio?: number,
): WallpaperFilter | undefined {
  const selectedFormat = BROWSE_FORMAT_OPTIONS.find((option) => option.value === format);
  const variants: NonNullable<WallpaperFilter['variants']> = {};

  if (selectedFormat && 'mimeType' in selectedFormat) {
    variants.format = selectedFormat.mimeType;
  }

  if (aspectRatio !== undefined) {
    variants.aspectRatio = aspectRatio;
  }

  if (Object.keys(variants).length === 0) {
    return undefined;
  }

  return {
    variants,
  };
}

export function buildAspectRatioFilter(
  aspectRatio: BrowseAspectRatioValue | undefined,
  deviceAspectRatioPreset: BrowseAspectRatioPresetValue,
): WallpaperFilter | undefined {
  const resolvedAspectRatio = getAspectRatioFilterValue(aspectRatio, deviceAspectRatioPreset);

  if (resolvedAspectRatio === undefined) {
    return undefined;
  }

  return {
    variants: {
      aspectRatio: resolvedAspectRatio,
    },
  };
}

export function buildWallpaperSort(color?: string): WallpaperSort | undefined {
  const normalizedColor = normalizeBrowseColorValue(color);

  if (!normalizedColor) {
    return undefined;
  }

  return {
    color: {
      colors: [{ amount: 1, color: normalizedColor }],
    },
  };
}

export function getColorBadgeLabel(color: string): string {
  return `Color: ${normalizeBrowseColorValue(color) ?? color.toUpperCase()}`;
}

export function getFormatBadgeLabel(format: BrowseFormatValue): string {
  return `Format: ${getFormatLabel(format)}`;
}

export function getAspectRatioBadgeLabel(
  aspectRatio: BrowseAspectRatioValue,
  deviceAspectRatioPreset: BrowseAspectRatioPresetValue,
): string {
  return `Aspect ratio: ${getAspectRatioLabel(aspectRatio, deviceAspectRatioPreset)}`;
}

export function getFormatLabel(format: BrowseFormatValue): string {
  return BROWSE_FORMAT_OPTIONS.find((option) => option.value === format)?.label ?? format;
}

export function getAspectRatioLabel(
  aspectRatio: BrowseAspectRatioValue,
  deviceAspectRatioPreset: BrowseAspectRatioPresetValue,
): string {
  if (aspectRatio === 'device') {
    return getDeviceAspectRatioOptionLabel(deviceAspectRatioPreset);
  }

  return BROWSE_ASPECT_RATIO_OPTIONS.find((option) => option.value === aspectRatio)?.label ?? aspectRatio;
}

export function getDeviceAspectRatioOptionLabel(
  deviceAspectRatioPreset: BrowseAspectRatioPresetValue,
): string {
  return `Device ${getAspectRatioPresetLabel(deviceAspectRatioPreset)}`;
}

export function resolveClosestAspectRatioPreset(ratio: number): BrowseAspectRatioPresetValue {
  let closestPreset: BrowseAspectRatioPresetValue = '16-9';
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const option of BROWSE_ASPECT_RATIO_OPTIONS) {
    if (!('ratio' in option)) {
      continue;
    }

    const distance = Math.abs(option.ratio - ratio);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestPreset = option.value;
    }
  }

  return closestPreset;
}

export function getAspectRatioFilterValue(
  aspectRatio: BrowseAspectRatioValue | undefined,
  deviceAspectRatioPreset: BrowseAspectRatioPresetValue,
): number | undefined {
  if (!aspectRatio) {
    return undefined;
  }

  const preset = aspectRatio === 'device' ? deviceAspectRatioPreset : aspectRatio;
  return BROWSE_ASPECT_RATIO_OPTIONS.find((option) => option.value === preset && 'ratio' in option)?.ratio;
}

function isBrowseFormatValue(value: unknown): value is BrowseFormatValue {
  return value === 'jpeg' || value === 'png' || value === 'webp';
}

function isBrowseAspectRatioValue(value: unknown): value is BrowseAspectRatioValue {
  return (
    value === 'device' ||
    value === '16-9' ||
    value === '16-10' ||
    value === '4-3' ||
    value === '9-16' ||
    value === '1-1' ||
    value === '21-9'
  );
}

function getAspectRatioPresetLabel(aspectRatio: BrowseAspectRatioPresetValue): string {
  return BROWSE_ASPECT_RATIO_OPTIONS.find((option) => option.value === aspectRatio)?.label ?? aspectRatio;
}

function normalizeBrowseColorValue(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  return /^#[0-9a-fA-F]{6}$/.test(value) ? value.toUpperCase() : undefined;
}

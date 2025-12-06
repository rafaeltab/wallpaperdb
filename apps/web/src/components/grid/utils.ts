import type { GridItem, ItemSpan } from './types';
import type { Wallpaper } from '@/lib/graphql/types';

/**
 * Aspect ratio thresholds for determining item spans.
 * These can be adjusted based on visual preferences.
 */
export const ASPECT_RATIO_THRESHOLDS = {
  /** Aspect ratio above which an image is considered ultrawide (e.g., 21:9 = 2.33) */
  ULTRAWIDE: 2.0,
  /** Aspect ratio below which an image is considered portrait (e.g., 9:16 = 0.5625) */
  PORTRAIT: 0.6,
} as const;

/**
 * Calculate the span for an item based on its aspect ratio.
 *
 * - Ultrawide images (AR >= 2.0): span 2 columns, 1 row
 * - Portrait images (AR <= 0.6): span 1 column, 2 rows
 * - Standard images: span 1 column, 1 row
 */
export function getDefaultSpan(item: GridItem): ItemSpan {
  const { aspectRatio } = item;

  if (aspectRatio >= ASPECT_RATIO_THRESHOLDS.ULTRAWIDE) {
    // Ultrawide (21:9, 32:9, etc.) → 2 columns, 1 row
    return { cols: 2, rows: 1 };
  }

  if (aspectRatio <= ASPECT_RATIO_THRESHOLDS.PORTRAIT) {
    // Portrait (9:16, 9:21, etc.) → 1 column, 2 rows
    return { cols: 1, rows: 2 };
  }

  // Standard (16:9, 4:3, 1:1, etc.) → 1 column, 1 row
  return { cols: 1, rows: 1 };
}

/**
 * Calculate the span for an expanded item.
 * Expanded items double their span in both dimensions.
 */
export function getExpandedSpan(baseSpan: ItemSpan): ItemSpan {
  return {
    cols: Math.min(baseSpan.cols * 2, 2) as ItemSpan['cols'],
    rows: Math.min(baseSpan.rows * 2, 2) as ItemSpan['rows'],
  };
}

/**
 * Convert a Wallpaper from the GraphQL API to a GridItem.
 * Uses the first variant for dimensions and URL.
 */
export function wallpaperToGridItem(wallpaper: Wallpaper): GridItem | null {
  const variant = wallpaper.variants[0];
  if (!variant) {
    return null;
  }

  return {
    id: wallpaper.wallpaperId,
    src: variant.url,
    width: variant.width,
    height: variant.height,
    aspectRatio: variant.aspectRatio,
    metadata: {
      userId: wallpaper.userId,
      uploadedAt: wallpaper.uploadedAt,
      variantCount: wallpaper.variants.length,
    },
  };
}

/**
 * Convert an array of Wallpapers to GridItems.
 * Filters out wallpapers without variants.
 */
export function wallpapersToGridItems(wallpapers: Wallpaper[]): GridItem[] {
  return wallpapers
    .map(wallpaperToGridItem)
    .filter((item): item is GridItem => item !== null);
}

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

/**
 * Configuration for image expansion behavior.
 */
export interface ExpansionConfig {
  /** Target area increase multiplier (e.g., 4.0 = 4x area, 2x dimensions) */
  areaMultiplier: number;
  /** Max width as fraction of container (e.g., 0.95) */
  maxWidthFraction: number;
  /** Max height as fraction of viewport (e.g., 0.85) */
  maxHeightFraction: number;
}

/**
 * Default expansion configuration.
 * Provides balanced growth for all aspect ratios.
 * Images are also capped at their native resolution to prevent upscaling.
 */
export const DEFAULT_EXPANSION_CONFIG: ExpansionConfig = {
  areaMultiplier: 4.0,
  maxWidthFraction: 0.95,
  maxHeightFraction: 0.85,
};

/**
 * Calculate expanded dimensions using area-based scaling with dimension caps.
 *
 * This algorithm ensures visually similar growth for all aspect ratios by:
 * 1. Targeting a consistent area increase (rather than linear width scaling)
 * 2. Capping both width AND height to prevent any image from dominating
 * 3. Scaling down proportionally when hitting either constraint
 *
 * @param baseWidth - Base width before expansion
 * @param baseHeight - Base height before expansion
 * @param aspectRatio - Image aspect ratio (width / height)
 * @param maxWidth - Maximum allowed width
 * @param maxHeight - Maximum allowed height
 * @param areaMultiplier - Target area increase (e.g., 2.25 for 2.25x area)
 */
export function calculateExpandedDimensions(
  baseWidth: number,
  baseHeight: number,
  aspectRatio: number,
  maxWidth: number,
  maxHeight: number,
  areaMultiplier: number,
): { width: number; height: number } {
  // Step 1: Calculate target area
  const baseArea = baseWidth * baseHeight;
  const targetArea = baseArea * areaMultiplier;

  // Step 2: Calculate ideal dimensions from target area preserving aspect ratio
  // Area = w * h, AR = w / h
  // Solving: w = sqrt(Area * AR), h = sqrt(Area / AR)
  const idealWidth = Math.sqrt(targetArea * aspectRatio);
  const idealHeight = Math.sqrt(targetArea / aspectRatio);

  // Step 3: Calculate scale factors for each constraint
  const widthScale = maxWidth / idealWidth;
  const heightScale = maxHeight / idealHeight;

  // Step 4: Use the more restrictive constraint (but don't scale up beyond ideal)
  const scaleFactor = Math.min(widthScale, heightScale, 1);

  return {
    width: idealWidth * scaleFactor,
    height: idealHeight * scaleFactor,
  };
}

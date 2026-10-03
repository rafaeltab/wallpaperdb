import type { Wallpaper } from '@/lib/graphql/types';

/**
 * Represents an item that can be displayed in the grid.
 * This is the contract between the data layer and the grid implementation.
 */
export interface GridItem {
  /** Unique identifier for the item */
  id: string;
  /** URL to the image source */
  src: string;
  /** Original image width in pixels */
  width: number;
  /** Original image height in pixels */
  height: number;
  /** Pre-calculated aspect ratio (width / height) */
  aspectRatio: number;
  /** Optional metadata for custom rendering or logic */
  metadata?: {
    profileId?: string;
    uploadedAt?: string;
    variantCount?: number;
    /** Full wallpaper object for actions (download, share, view) */
    wallpaper?: Wallpaper;
  };
  /** Whether this is a skeleton placeholder item */
  isSkeleton?: boolean;
}

/**
 * How many grid cells an item should span.
 * Can be extended to support larger spans (3, 4) if needed.
 */
export type SpanSize = 1 | 2;

/**
 * Defines how an item spans across the grid.
 */
export interface ItemSpan {
  /** Number of columns to span */
  cols: SpanSize;
  /** Number of rows to span */
  rows: SpanSize;
}

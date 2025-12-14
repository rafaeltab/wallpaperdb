import type { ComponentType } from 'react';

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
  metadata?: Record<string, unknown>;
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

/**
 * Props passed to the item renderer component.
 */
export interface GridItemRendererProps {
  /** The item data to render */
  item: GridItem;
  /** Whether this item is currently expanded */
  isExpanded: boolean;
  /** Current span of the item */
  span: ItemSpan;
  /** Handler for click events */
  onClick: () => void;
  /** Handler for mouse enter events */
  onMouseEnter: () => void;
  /** Handler for mouse leave events */
  onMouseLeave: () => void;
}

/**
 * Props for the abstract grid component.
 * Any grid implementation (Muuri, CSS Grid, Masonry, etc.) must accept these props.
 */
export interface GridProps {
  /** Items to display in the grid */
  items: GridItem[];
  /** Base size for grid cells in pixels */
  baseSize?: number;
  /** Gap between items in pixels */
  gap?: number;
  /**
   * Function to calculate span for an item.
   * If not provided, uses default aspect-ratio-based calculation.
   */
  getSpan?: (item: GridItem) => ItemSpan;
  /**
   * Component to render each item.
   * If not provided, uses default WallpaperCard.
   */
  ItemRenderer?: ComponentType<GridItemRendererProps>;
  /** Called when an item is clicked */
  onItemClick?: (item: GridItem) => void;
  /** Called when mouse enters an item */
  onItemHover?: (item: GridItem) => void;
  /** Called when mouse leaves an item */
  onItemLeave?: (item: GridItem) => void;
  /** Set of item IDs that are currently expanded */
  expandedItems?: Set<string>;
}

/**
 * Registry entry for a grid strategy.
 */
export interface GridStrategy {
  /** Unique name for the strategy */
  name: string;
  /** The grid component implementation */
  component: ComponentType<GridProps>;
}

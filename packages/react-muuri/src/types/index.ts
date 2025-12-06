/**
 * TypeScript type definitions for @wallpaperdb/react-muuri
 *
 * Muuri core types are imported directly from the 'muuri' package.
 * This file defines React-specific types for our wrapper components.
 */

import type { ReactNode } from 'react';
import type Grid from 'muuri';
import type { Item, GridOptions, GridEvents, LayoutOnFinish } from 'muuri';

// =============================================================================
// Re-export Muuri types for convenience
// =============================================================================

/** Re-export Muuri Grid as MuuriInstance for backwards compatibility */
export type MuuriInstance = Grid;

/** Re-export Muuri Item as MuuriItem for backwards compatibility */
export type MuuriItem = Item;

/** Re-export Muuri GridOptions as MuuriOptions for backwards compatibility */
export type MuuriOptions = GridOptions;

/** Re-export Muuri GridEvents as MuuriEvents for backwards compatibility */
export type MuuriEvents = GridEvents;

// Re-export commonly used Muuri types
export type { GridOptions, GridEvents, Item, LayoutOnFinish } from 'muuri';

// =============================================================================
// React Component Types
// =============================================================================

/**
 * Filter predicate function
 */
export type FilterPredicate = (item: Item) => boolean;

/**
 * Sort comparer function
 */
export type SortComparer = (a: Item, b: Item) => number;

/**
 * Filter options for grid filtering
 */
export interface FilterOptions {
  /** Instant animation */
  instant?: boolean;
  /** Sync with layout */
  syncWithLayout?: boolean;
  /** Layout after filter */
  layout?: boolean | 'instant' | LayoutOnFinish;
  /** Callback when complete */
  onFinish?: (items: Item[]) => void;
}

/**
 * Sort options for grid sorting
 */
export interface SortOptions {
  /** Descending order */
  descending?: boolean;
  /** Layout after sort */
  layout?: boolean | 'instant' | LayoutOnFinish;
}

/**
 * MuuriGrid component props
 */
export interface MuuriGridProps
  extends Omit<GridOptions, 'items'>,
    Omit<React.HTMLAttributes<HTMLDivElement>, 'onDragStart' | 'onDragEnd'> {
  /** Grid content (MuuriItem components) */
  children?: ReactNode;

  // Event callbacks - using Muuri's event types
  /** Called when layout starts */
  onLayoutStart?: GridEvents['layoutStart'];
  /** Called when layout ends */
  onLayoutEnd?: GridEvents['layoutEnd'];
  /** Called when items are added */
  onAdd?: GridEvents['add'];
  /** Called when items are removed */
  onRemove?: GridEvents['remove'];
  /** Called when items are shown */
  onShow?: (items: Item[]) => void;
  /** Called when items are hidden */
  onHide?: (items: Item[]) => void;
  /** Called when filter is applied */
  onFilter?: GridEvents['filter'];
  /** Called when sort is applied */
  onSort?: GridEvents['sort'];
  /** Called when item is moved */
  onMove?: GridEvents['move'];
  /** Called when drag is initialized */
  onDragInit?: GridEvents['dragInit'];
  /** Called when drag starts */
  onDragStart?: GridEvents['dragStart'];
  /** Called during drag */
  onDragMove?: GridEvents['dragMove'];
  /** Called when drag ends */
  onDragEnd?: GridEvents['dragEnd'];
  /** Called when drag release animation starts */
  onDragReleaseStart?: GridEvents['dragReleaseStart'];
  /** Called when drag release animation ends */
  onDragReleaseEnd?: GridEvents['dragReleaseEnd'];
  /** Called when item is sent to another grid */
  onSend?: GridEvents['send'];
  /** Called when item is received from another grid */
  onReceive?: GridEvents['receive'];
}

/**
 * MuuriItem component props
 */
export interface MuuriItemProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Item content */
  children?: ReactNode;
  /** Custom item key for React reconciliation */
  itemKey?: string;
}

// =============================================================================
// Hook Types
// =============================================================================

/**
 * useGrid hook return type
 */
export interface UseGridReturn {
  /** The Muuri grid instance (null during SSR or before initialization) */
  grid: Grid | null;
  /** Get all items in the grid */
  getItems: () => Item[];
  /** Trigger a layout recalculation */
  layout: (instant?: boolean) => void;
  /** Filter items using a predicate */
  filter: (predicate: string | FilterPredicate, options?: FilterOptions) => void;
  /** Sort items */
  sort: (comparer: string | SortComparer | Item[], options?: SortOptions) => void;
  /** Refresh item dimensions */
  refreshItems: (items?: Item[], force?: boolean) => void;
  /** Refresh sort data */
  refreshSortData: (items?: Item[]) => void;
}

/**
 * useItem hook return type
 */
export interface UseItemReturn {
  /** The Muuri item instance (null if not in MuuriItem context) */
  item: Item | null;
  /** Item is currently being dragged */
  isDragging: boolean;
  /** Item is being positioned after layout */
  isPositioning: boolean;
  /** Item is visible */
  isVisible: boolean;
  /** Item is showing (transitioning to visible) */
  isShowing: boolean;
  /** Item is hiding (transitioning to hidden) */
  isHiding: boolean;
  /** Item is releasing from drag */
  isReleasing: boolean;
}

/**
 * useDrag hook return type
 */
export interface UseDragReturn {
  /** Item is currently being dragged */
  isDragging: boolean;
  /** Item is releasing from drag */
  isReleasing: boolean;
}

/**
 * useFilter hook return type
 */
export interface UseFilterReturn {
  /** Apply a filter to the grid */
  filter: (predicate: string | FilterPredicate, options?: FilterOptions) => void;
}

/**
 * useSort hook return type
 */
export interface UseSortReturn {
  /** Sort the grid */
  sort: (comparer: string | SortComparer | Item[], options?: SortOptions) => void;
}

/**
 * useLayout hook return type
 */
export interface UseLayoutReturn {
  /** Trigger a layout recalculation */
  layout: (instant?: boolean) => void;
}

/**
 * useRefresh hook return type
 */
export interface UseRefreshReturn {
  /** Refresh the item's dimensions */
  refresh: (force?: boolean) => void;
}

// =============================================================================
// Context Types
// =============================================================================

/**
 * MuuriContext value
 */
export interface MuuriContextValue {
  /** The grid instance */
  grid: Grid | null;
  /** Register an item element with the grid */
  registerItem: (element: HTMLElement, key: string) => Item | null;
  /** Unregister an item from the grid */
  unregisterItem: (key: string) => void;
}

/**
 * ItemContext value
 */
export interface ItemContextValue {
  /** The item instance */
  item: Item | null;
  /** The item's unique key */
  itemKey: string;
}

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Item data stored for filtering/sorting
 */
export type ItemData = Record<string, unknown>;

/**
 * Declarative filter configuration
 */
export interface DeclarativeFilter {
  /** Filter predicate function */
  predicate: FilterPredicate;
  /** Filter options */
  options?: FilterOptions;
}

/**
 * Declarative sort configuration
 */
export interface DeclarativeSort {
  /** Sort comparer or data keys */
  comparer: string | string[] | SortComparer;
  /** Sort options */
  options?: SortOptions;
}

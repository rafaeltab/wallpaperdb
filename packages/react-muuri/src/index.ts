'use client';

/**
 * @wallpaperdb/react-muuri
 *
 * Modern React 18/19 compatible wrapper for Muuri layout library.
 * Based on muuri-react API patterns but rewritten for modern React.
 */

// Re-export Muuri types directly for convenience
export type {
  // Muuri Core Types
  Item as MuuriItemInstance,
  GridOptions as MuuriOptions,
  GridEvents as MuuriEvents,
  // Layout Types
  LayoutOptions,
  LayoutFunction,
  LayoutOnFinish as LayoutCallback,
  // Drag Types
  DragStartPredicateOptions as DragStartPredicate,
  DragStartPredicate as DragStartPredicateFunction,
  DragSortHeuristics,
  DragSortPredicateOptions as DragSortPredicate,
  DragSortPredicate as DragSortPredicateFunction,
  DragReleaseOptions,
  DragPlaceholderOptions,
  DragAutoScrollOptions,
  DraggerCssProps as DragCssProps,
  DragAutoScrollTarget as AutoScrollTarget,
  // Sort/Filter Types
  SortDataGetter,
} from 'muuri';

// Export our custom types
export type {
  // Backwards compatibility aliases
  MuuriItem as MuuriItemType,
  MuuriInstance,
  // Filter/Sort Types
  FilterPredicate,
  SortComparer,
  FilterOptions,
  SortOptions,
  // React Component Types
  MuuriGridProps,
  MuuriItemProps,
  // Hook Types
  UseGridReturn,
  UseItemReturn,
  UseDragReturn,
  UseFilterReturn,
  UseSortReturn,
  UseLayoutReturn,
  UseRefreshReturn,
  // Context Types
  MuuriContextValue,
  ItemContextValue,
  // Utility Types
  ItemData,
  DeclarativeFilter,
  DeclarativeSort,
} from './types/index.js';

// Components
export { MuuriGrid } from './MuuriGrid.js';
export { MuuriItem } from './MuuriItem.js';

// Contexts
export { MuuriContext, MuuriProvider } from './context/MuuriContext.js';
export { ItemContext, ItemProvider } from './context/ItemContext.js';

// Hooks - Phase 3
export { useGrid } from './hooks/useGrid.js';
export { useItem } from './hooks/useItem.js';
export { useLayout } from './hooks/useLayout.js';
export { useRefresh } from './hooks/useRefresh.js';

// Hooks - Phase 4
export { useDrag } from './hooks/useDrag.js';

// Hooks - Phase 5
export { useFilter } from './hooks/useFilter.js';
export { useSort } from './hooks/useSort.js';

// Utilities
export {
  createDragEventBridge,
  createVisibilityEventBridge,
  type EventBridgeCleanup,
  type DragEventCallbacks,
  type VisibilityEventCallbacks,
} from './utils/event-bridge.js';

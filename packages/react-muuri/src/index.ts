'use client';

/**
 * @wallpaperdb/react-muuri
 *
 * Modern React 18/19 compatible wrapper for Muuri layout library.
 * Based on muuri-react API patterns but rewritten for modern React.
 */

// Types
export type {
  // Muuri Core Types
  MuuriItem as MuuriItemInstance,
  MuuriInstance,
  MuuriItemElement,
  MuuriOptions,
  MuuriEvents,
  MuuriEventName,
  // Layout Types
  LayoutOptions,
  LayoutFunction,
  LayoutCallback,
  // Drag Types
  DragStartPredicate,
  DragStartPredicateFunction,
  DragSortHeuristics,
  DragSortPredicate,
  DragSortPredicateFunction,
  DragReleaseOptions,
  DragPlaceholderOptions,
  DragAutoScrollOptions,
  DragCssProps,
  AutoScrollTarget,
  // Sort/Filter Types
  SortDataGetter,
  FilterPredicate,
  SortComparer,
  // Options Types
  AddOptions,
  RemoveOptions,
  VisibilityOptions,
  FilterOptions,
  SortOptions,
  MoveOptions,
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

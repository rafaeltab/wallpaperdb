/**
 * TypeScript type definitions for Muuri and @wallpaperdb/react-muuri
 *
 * Since Muuri doesn't ship with TypeScript types and @types/muuri doesn't exist,
 * we define comprehensive types here for both the underlying Muuri library and
 * our React wrapper components.
 */

import type { CSSProperties, ReactNode } from 'react';

// =============================================================================
// Muuri Core Types
// =============================================================================

/**
 * A Muuri item element - the DOM element managed by Muuri
 */
export interface MuuriItemElement extends HTMLElement {
  _component?: unknown;
}

/**
 * Muuri Item instance - represents a single item in the grid
 */
export interface MuuriItem {
  /** Get the item's DOM element */
  getElement(): MuuriItemElement | null;
  /** Get the grid instance the item belongs to */
  getGrid(): MuuriInstance;
  /** Get the item's position */
  getPosition(): { left: number; top: number };
  /** Get the item's width */
  getWidth(): number;
  /** Get the item's height */
  getHeight(): number;
  /** Get the item's margin */
  getMargin(): { left: number; right: number; top: number; bottom: number };
  /** Check if item is active */
  isActive(): boolean;
  /** Check if item is visible */
  isVisible(): boolean;
  /** Check if item is showing */
  isShowing(): boolean;
  /** Check if item is hiding */
  isHiding(): boolean;
  /** Check if item is positioning */
  isPositioning(): boolean;
  /** Check if item is dragging */
  isDragging(): boolean;
  /** Check if item is releasing */
  isReleasing(): boolean;
  /** Check if item is destroyed */
  isDestroyed(): boolean;
}

/**
 * Layout algorithm options
 */
export interface LayoutOptions {
  /** Fill gaps in layout */
  fillGaps?: boolean;
  /** Layout horizontally */
  horizontal?: boolean;
  /** Align items to the right */
  alignRight?: boolean;
  /** Align items to the bottom */
  alignBottom?: boolean;
  /** Round positions and sizes */
  rounding?: boolean;
}

/**
 * Layout function callback
 */
export type LayoutFunction = (
  grid: MuuriInstance,
  layoutId: number,
  items: MuuriItem[],
  width: number,
  height: number,
  callback: (items: MuuriItem[], width: number, height: number) => void
) => void;

/**
 * Drag start predicate options
 */
export interface DragStartPredicate {
  /** Distance in pixels before drag starts */
  distance?: number;
  /** Delay in milliseconds before drag starts */
  delay?: number;
}

/**
 * Drag start predicate function
 */
export type DragStartPredicateFunction = (
  item: MuuriItem,
  event: MouseEvent | TouchEvent
) => boolean | undefined;

/**
 * Drag sort heuristics options
 */
export interface DragSortHeuristics {
  /** Minimum interval between sort checks in ms */
  sortInterval?: number;
  /** Minimum drag distance before sorting */
  minDragDistance?: number;
  /** Minimum bounce back angle in radians */
  minBounceBackAngle?: number;
}

/**
 * Drag sort predicate options
 */
export interface DragSortPredicate {
  /** Threshold for overlap detection (0-100) */
  threshold?: number;
  /** Action to perform: 'move' or 'swap' */
  action?: 'move' | 'swap';
  /** Migration action for cross-grid drags */
  migrateAction?: 'move' | 'swap';
}

/**
 * Drag sort predicate function
 */
export type DragSortPredicateFunction = (
  item: MuuriItem,
  event: MouseEvent | TouchEvent
) => { index: number; grid?: MuuriInstance; action?: 'move' | 'swap' } | null | undefined;

/**
 * Drag release animation options
 */
export interface DragReleaseOptions {
  /** Release animation duration in ms */
  duration?: number;
  /** Release animation easing */
  easing?: string;
  /** Use drag container during release */
  useDragContainer?: boolean;
}

/**
 * Drag placeholder options
 */
export interface DragPlaceholderOptions {
  /** Enable placeholder */
  enabled?: boolean;
  /** Custom placeholder element creator */
  createElement?: (item: MuuriItem) => HTMLElement;
  /** Callback when placeholder is created */
  onCreate?: (item: MuuriItem, placeholderElement: HTMLElement) => void;
  /** Callback when placeholder is removed */
  onRemove?: (item: MuuriItem, placeholderElement: HTMLElement) => void;
}

/**
 * Auto-scroll target configuration
 */
export interface AutoScrollTarget {
  /** Target element or window */
  element: HTMLElement | Window;
  /** Priority for multiple targets */
  priority?: number;
  /** Scroll axes: 0=none, 1=x, 2=y, 3=both */
  axis?: 0 | 1 | 2 | 3;
}

/**
 * Drag auto-scroll options
 */
export interface DragAutoScrollOptions {
  /** Scroll targets */
  targets?: AutoScrollTarget[] | (() => AutoScrollTarget[]);
  /** Handle element function */
  handle?: ((item: MuuriItem) => HTMLElement) | null;
  /** Threshold for scroll trigger (0-1) */
  threshold?: number;
  /** Safe zone where scroll won't trigger (0-1) */
  safeZone?: number;
  /** Scroll speed function */
  speed?:
    | number
    | ((
        item: MuuriItem,
        scrollElement: HTMLElement | Window,
        scrollData: {
          direction: number;
          threshold: number;
          distance: number;
          value: number;
          maxValue: number;
          duration: number;
          speed: number;
          deltaTime: number;
          isEnding: boolean;
        }
      ) => number);
  /** Smooth stop */
  smoothStop?: boolean;
  /** On start callback */
  onStart?: (item: MuuriItem, scrollElement: HTMLElement | Window, direction: number) => void;
  /** On stop callback */
  onStop?: (item: MuuriItem, scrollElement: HTMLElement | Window, direction: number) => void;
}

/**
 * CSS properties applied during drag
 */
export interface DragCssProps {
  touchAction?: string;
  userSelect?: string;
  userDrag?: string;
  tapHighlightColor?: string;
  touchCallout?: string;
  contentZooming?: string;
}

/**
 * Sort data getter function
 */
export type SortDataGetter = (item: MuuriItem, element: HTMLElement) => unknown;

/**
 * Full Muuri grid options
 */
export interface MuuriOptions {
  // Container & Items
  /** Initial items selector or array */
  items?: string | HTMLElement[];

  // Layout
  /** Layout algorithm configuration */
  layout?: LayoutOptions | LayoutFunction;
  /** Trigger layout on window resize (ms debounce or boolean) */
  layoutOnResize?: number | boolean;
  /** Trigger layout on initialization */
  layoutOnInit?: boolean;
  /** Layout animation duration in ms */
  layoutDuration?: number;
  /** Layout animation easing */
  layoutEasing?: string;

  // Visibility Animation
  /** Show animation duration in ms */
  showDuration?: number;
  /** Show animation easing */
  showEasing?: string;
  /** Hide animation duration in ms */
  hideDuration?: number;
  /** Hide animation easing */
  hideEasing?: string;
  /** CSS styles for visible items */
  visibleStyles?: CSSProperties;
  /** CSS styles for hidden items */
  hiddenStyles?: CSSProperties;

  // Drag & Drop
  /** Enable item dragging */
  dragEnabled?: boolean;
  /** Container for dragged items */
  dragContainer?: HTMLElement | null;
  /** Drag handle selector */
  dragHandle?: string | null;
  /** Drag axis: 'x', 'y', or 'xy' */
  dragAxis?: 'x' | 'y' | 'xy';
  /** Enable sorting during drag */
  dragSort?: boolean | (() => MuuriInstance[]);
  /** Drag start predicate configuration */
  dragStartPredicate?: DragStartPredicate | DragStartPredicateFunction;
  /** Drag sort heuristics */
  dragSortHeuristics?: DragSortHeuristics;
  /** Drag sort predicate */
  dragSortPredicate?: DragSortPredicate | DragSortPredicateFunction;
  /** Drag release animation options */
  dragRelease?: DragReleaseOptions;
  /** CSS props during drag */
  dragCssProps?: DragCssProps;
  /** Drag placeholder configuration */
  dragPlaceholder?: DragPlaceholderOptions;
  /** Auto-scroll configuration */
  dragAutoScroll?: DragAutoScrollOptions;

  // Sorting
  /** Sort data getters */
  sortData?: Record<string, SortDataGetter> | null;

  // CSS Classes
  /** Grid container class */
  containerClass?: string;
  /** Item class */
  itemClass?: string;
  /** Visible item class */
  itemVisibleClass?: string;
  /** Hidden item class */
  itemHiddenClass?: string;
  /** Positioning item class */
  itemPositioningClass?: string;
  /** Dragging item class */
  itemDraggingClass?: string;
  /** Releasing item class */
  itemReleasingClass?: string;
  /** Placeholder class */
  itemPlaceholderClass?: string;
}

/**
 * Muuri add() options
 */
export interface AddOptions {
  /** Index to add items at */
  index?: number;
  /** Animate layout after add */
  layout?: boolean | 'instant' | LayoutCallback;
}

/**
 * Muuri remove() options
 */
export interface RemoveOptions {
  /** Remove elements from DOM */
  removeElements?: boolean;
  /** Animate layout after remove */
  layout?: boolean | 'instant' | LayoutCallback;
}

/**
 * Muuri show()/hide() options
 */
export interface VisibilityOptions {
  /** Instant animation */
  instant?: boolean;
  /** Sync animations */
  syncWithLayout?: boolean;
  /** Layout after visibility change */
  layout?: boolean | 'instant' | LayoutCallback;
  /** Callback when complete */
  onFinish?: (items: MuuriItem[]) => void;
}

/**
 * Muuri filter() options
 */
export interface FilterOptions {
  /** Instant animation */
  instant?: boolean;
  /** Sync with layout */
  syncWithLayout?: boolean;
  /** Layout after filter */
  layout?: boolean | 'instant' | LayoutCallback;
  /** Callback when complete */
  onFinish?: (shownItems: MuuriItem[], hiddenItems: MuuriItem[]) => void;
}

/**
 * Muuri sort() options
 */
export interface SortOptions {
  /** Descending order */
  descending?: boolean;
  /** Layout after sort */
  layout?: boolean | 'instant' | LayoutCallback;
}

/**
 * Muuri move() options
 */
export interface MoveOptions {
  /** Action: 'move' or 'swap' */
  action?: 'move' | 'swap';
  /** Layout after move */
  layout?: boolean | 'instant' | LayoutCallback;
}

/**
 * Layout callback
 */
export type LayoutCallback = (items: MuuriItem[], hasLayoutChanged: boolean) => void;

/**
 * Filter predicate function
 */
export type FilterPredicate = (item: MuuriItem) => boolean;

/**
 * Sort comparer function
 */
export type SortComparer = (a: MuuriItem, b: MuuriItem) => number;

// =============================================================================
// Muuri Instance
// =============================================================================

/**
 * Muuri grid instance
 */
export interface MuuriInstance {
  /** Get the grid's DOM element */
  getElement(): HTMLElement;
  /** Get a single item by index, element, or instance */
  getItem(target: number | HTMLElement | MuuriItem): MuuriItem | null;
  /** Get items array, optionally filtered by state */
  getItems(
    targets?: number | HTMLElement | MuuriItem | (number | HTMLElement | MuuriItem)[]
  ): MuuriItem[];
  /** Refresh cached item dimensions */
  refreshItems(items?: MuuriItem[], force?: boolean): MuuriInstance;
  /** Refresh sort data values */
  refreshSortData(items?: MuuriItem[]): MuuriInstance;
  /** Synchronize DOM order with grid item order */
  synchronize(): MuuriInstance;
  /** Calculate and apply item positions */
  layout(instant?: boolean, callback?: LayoutCallback): MuuriInstance;
  /** Add new items to the grid */
  add(elements: HTMLElement | HTMLElement[], options?: AddOptions): MuuriItem[];
  /** Remove items from the grid */
  remove(items: MuuriItem | MuuriItem[], options?: RemoveOptions): MuuriItem[];
  /** Show items with animation */
  show(items: MuuriItem | MuuriItem[], options?: VisibilityOptions): MuuriInstance;
  /** Hide items with animation */
  hide(items: MuuriItem | MuuriItem[], options?: VisibilityOptions): MuuriInstance;
  /** Filter items based on predicate */
  filter(predicate: string | FilterPredicate, options?: FilterOptions): MuuriInstance;
  /** Sort items */
  sort(
    comparer: string | string[] | SortComparer | MuuriItem[],
    options?: SortOptions
  ): MuuriInstance;
  /** Move item to new position */
  move(
    item: MuuriItem | HTMLElement | number,
    position: MuuriItem | HTMLElement | number,
    options?: MoveOptions
  ): MuuriInstance;
  /** Send item to another grid */
  send(
    item: MuuriItem | HTMLElement | number,
    targetGrid: MuuriInstance,
    position: MuuriItem | HTMLElement | number,
    options?: MoveOptions
  ): MuuriInstance;
  /** Bind event listener */
  on<K extends keyof MuuriEvents>(event: K, listener: MuuriEvents[K]): MuuriInstance;
  /** Unbind event listener */
  off<K extends keyof MuuriEvents>(event: K, listener: MuuriEvents[K]): MuuriInstance;
  /** Destroy the grid */
  destroy(removeElements?: boolean): MuuriInstance;
}

// =============================================================================
// Muuri Events
// =============================================================================

/**
 * All Muuri events and their listener signatures
 */
export interface MuuriEvents {
  // Lifecycle
  synchronize: () => void;
  destroy: () => void;

  // Layout
  layoutStart: (items: MuuriItem[], isInstant: boolean) => void;
  layoutEnd: (items: MuuriItem[]) => void;
  layoutAbort: (items: MuuriItem[]) => void;

  // Add/Remove
  add: (items: MuuriItem[]) => void;
  remove: (items: MuuriItem[], indices: number[]) => void;

  // Visibility
  showStart: (items: MuuriItem[]) => void;
  showEnd: (items: MuuriItem[]) => void;
  hideStart: (items: MuuriItem[]) => void;
  hideEnd: (items: MuuriItem[]) => void;

  // Filter/Sort/Move
  filter: (shownItems: MuuriItem[], hiddenItems: MuuriItem[]) => void;
  sort: (currentOrder: MuuriItem[], previousOrder: MuuriItem[]) => void;
  move: (data: {
    item: MuuriItem;
    fromIndex: number;
    toIndex: number;
    action: 'move' | 'swap';
  }) => void;

  // Send/Receive (cross-grid)
  send: (data: {
    item: MuuriItem;
    fromGrid: MuuriInstance;
    fromIndex: number;
    toGrid: MuuriInstance;
    toIndex: number;
  }) => void;
  beforeSend: (data: {
    item: MuuriItem;
    fromGrid: MuuriInstance;
    fromIndex: number;
    toGrid: MuuriInstance;
    toIndex: number;
  }) => void;
  receive: (data: {
    item: MuuriItem;
    fromGrid: MuuriInstance;
    fromIndex: number;
    toGrid: MuuriInstance;
    toIndex: number;
  }) => void;
  beforeReceive: (data: {
    item: MuuriItem;
    fromGrid: MuuriInstance;
    fromIndex: number;
    toGrid: MuuriInstance;
    toIndex: number;
  }) => void;

  // Drag
  dragInit: (item: MuuriItem, event: MouseEvent | TouchEvent) => void;
  dragStart: (item: MuuriItem, event: MouseEvent | TouchEvent) => void;
  dragMove: (item: MuuriItem, event: MouseEvent | TouchEvent) => void;
  dragScroll: (item: MuuriItem, event: Event) => void;
  dragEnd: (item: MuuriItem, event: MouseEvent | TouchEvent) => void;
  dragReleaseStart: (item: MuuriItem) => void;
  dragReleaseEnd: (item: MuuriItem) => void;
}

/**
 * Muuri event name type
 */
export type MuuriEventName = keyof MuuriEvents;

// =============================================================================
// React Component Types
// =============================================================================

/**
 * MuuriGrid component props
 */
export interface MuuriGridProps
  extends Omit<MuuriOptions, 'items'>,
    Omit<React.HTMLAttributes<HTMLDivElement>, 'onDragStart' | 'onDragEnd'> {
  /** Grid content (MuuriItem components) */
  children?: ReactNode;

  // Event callbacks
  /** Called when layout starts */
  onLayoutStart?: (items: MuuriItem[], isInstant: boolean) => void;
  /** Called when layout ends */
  onLayoutEnd?: (items: MuuriItem[]) => void;
  /** Called when items are added */
  onAdd?: (items: MuuriItem[]) => void;
  /** Called when items are removed */
  onRemove?: (items: MuuriItem[], indices: number[]) => void;
  /** Called when items are shown */
  onShow?: (items: MuuriItem[]) => void;
  /** Called when items are hidden */
  onHide?: (items: MuuriItem[]) => void;
  /** Called when filter is applied */
  onFilter?: (shownItems: MuuriItem[], hiddenItems: MuuriItem[]) => void;
  /** Called when sort is applied */
  onSort?: (currentOrder: MuuriItem[], previousOrder: MuuriItem[]) => void;
  /** Called when item is moved */
  onMove?: (data: {
    item: MuuriItem;
    fromIndex: number;
    toIndex: number;
    action: 'move' | 'swap';
  }) => void;
  /** Called when drag is initialized */
  onDragInit?: (item: MuuriItem, event: MouseEvent | TouchEvent) => void;
  /** Called when drag starts */
  onDragStart?: (item: MuuriItem, event: MouseEvent | TouchEvent) => void;
  /** Called during drag */
  onDragMove?: (item: MuuriItem, event: MouseEvent | TouchEvent) => void;
  /** Called when drag ends */
  onDragEnd?: (item: MuuriItem, event: MouseEvent | TouchEvent) => void;
  /** Called when drag release animation starts */
  onDragReleaseStart?: (item: MuuriItem) => void;
  /** Called when drag release animation ends */
  onDragReleaseEnd?: (item: MuuriItem) => void;
  /** Called when item is sent to another grid */
  onSend?: (data: {
    item: MuuriItem;
    fromGrid: MuuriInstance;
    fromIndex: number;
    toGrid: MuuriInstance;
    toIndex: number;
  }) => void;
  /** Called when item is received from another grid */
  onReceive?: (data: {
    item: MuuriItem;
    fromGrid: MuuriInstance;
    fromIndex: number;
    toGrid: MuuriInstance;
    toIndex: number;
  }) => void;
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
  grid: MuuriInstance | null;
  /** Get all items in the grid */
  getItems: () => MuuriItem[];
  /** Trigger a layout recalculation */
  layout: (instant?: boolean) => void;
  /** Filter items using a predicate */
  filter: (predicate: string | FilterPredicate, options?: FilterOptions) => void;
  /** Sort items */
  sort: (comparer: string | string[] | SortComparer | MuuriItem[], options?: SortOptions) => void;
  /** Refresh item dimensions */
  refreshItems: (items?: MuuriItem[], force?: boolean) => void;
  /** Refresh sort data */
  refreshSortData: (items?: MuuriItem[]) => void;
}

/**
 * useItem hook return type
 */
export interface UseItemReturn {
  /** The Muuri item instance (null if not in MuuriItem context) */
  item: MuuriItem | null;
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
  sort: (comparer: string | string[] | SortComparer | MuuriItem[], options?: SortOptions) => void;
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
  grid: MuuriInstance | null;
  /** Register an item element with the grid */
  registerItem: (element: HTMLElement, key: string) => MuuriItem | null;
  /** Unregister an item from the grid */
  unregisterItem: (key: string) => void;
}

/**
 * ItemContext value
 */
export interface ItemContextValue {
  /** The item instance */
  item: MuuriItem | null;
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

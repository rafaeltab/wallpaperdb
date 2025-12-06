'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { MuuriContext } from './context/MuuriContext.js';
import type Muuri from 'muuri';
import type { Item, GridOptions } from 'muuri';
import type { MuuriContextValue, MuuriGridProps } from './types/index.js';

/**
 * MuuriGrid component - the main container for Muuri layout.
 *
 * This component initializes a Muuri grid and provides context for child MuuriItem components.
 * It handles React 18+ StrictMode correctly by cleaning up and reinitializing Muuri.
 *
 * @example
 * ```tsx
 * <MuuriGrid dragEnabled layoutDuration={300}>
 *   {items.map(item => (
 *     <MuuriItem key={item.id}>
 *       <div className="card">{item.content}</div>
 *     </MuuriItem>
 *   ))}
 * </MuuriGrid>
 * ```
 */
export const MuuriGrid = forwardRef<Muuri | null, MuuriGridProps>(function MuuriGrid(
  {
    children,
    className,
    style,
    // Layout options
    layout,
    layoutOnResize = 150,
    layoutOnInit = true,
    layoutDuration = 300,
    layoutEasing = 'ease',
    // Visibility animation
    showDuration = 300,
    showEasing = 'ease',
    hideDuration = 300,
    hideEasing = 'ease',
    visibleStyles,
    hiddenStyles,
    // Drag options
    dragEnabled = false,
    dragContainer,
    dragHandle,
    dragAxis,
    dragSort = true,
    dragStartPredicate,
    dragSortHeuristics,
    dragSortPredicate,
    dragRelease,
    dragCssProps,
    dragPlaceholder,
    dragAutoScroll,
    // Sorting
    sortData,
    // CSS Classes
    containerClass = 'muuri',
    itemClass = 'muuri-item',
    itemVisibleClass = 'muuri-item-shown',
    itemHiddenClass = 'muuri-item-hidden',
    itemPositioningClass = 'muuri-item-positioning',
    itemDraggingClass = 'muuri-item-dragging',
    itemReleasingClass = 'muuri-item-releasing',
    itemPlaceholderClass = 'muuri-item-placeholder',
    // Event callbacks
    onLayoutStart,
    onLayoutEnd,
    onAdd,
    onRemove,
    onShow,
    onHide,
    onFilter,
    onSort,
    onMove,
    onDragInit,
    onDragStart,
    onDragMove,
    onDragEnd,
    onDragReleaseStart,
    onDragReleaseEnd,
    onSend,
    onReceive,
    // HTML attributes
    ...htmlProps
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [grid, setGrid] = useState<Muuri | null>(null);
  const itemsMapRef = useRef<Map<string, { element: HTMLElement; item: Item | null }>>(new Map());
  const pendingItemsRef = useRef<HTMLElement[]>([]);
  const isInitializedRef = useRef(false);

  // Store callbacks in refs to avoid re-subscribing on every render
  const callbacksRef = useRef({
    onLayoutStart,
    onLayoutEnd,
    onAdd,
    onRemove,
    onShow,
    onHide,
    onFilter,
    onSort,
    onMove,
    onDragInit,
    onDragStart,
    onDragMove,
    onDragEnd,
    onDragReleaseStart,
    onDragReleaseEnd,
    onSend,
    onReceive,
  });

  // Update callbacks ref on each render
  callbacksRef.current = {
    onLayoutStart,
    onLayoutEnd,
    onAdd,
    onRemove,
    onShow,
    onHide,
    onFilter,
    onSort,
    onMove,
    onDragInit,
    onDragStart,
    onDragMove,
    onDragEnd,
    onDragReleaseStart,
    onDragReleaseEnd,
    onSend,
    onReceive,
  };

  // Expose grid instance via ref (null means not initialized yet)
  // Using effect instead of useImperativeHandle for better null handling
  useEffect(() => {
    if (typeof ref === 'function') {
      ref(grid);
    } else if (ref) {
      ref.current = grid;
    }
  }, [ref, grid]);

  // Initialize Muuri
  useEffect(() => {
    if (!containerRef.current || typeof window === 'undefined') return;

    let muuriInstance: Muuri | null = null;
    let isCancelled = false;

    const initMuuri = async () => {
      // Dynamic import to avoid SSR issues
      const MuuriModule = await import('muuri');
      const MuuriClass = MuuriModule.default;

      if (isCancelled || !containerRef.current) return;

      // Get all item elements that were registered before initialization
      const initialItems = [...pendingItemsRef.current];
      pendingItemsRef.current = [];

      // Build Muuri options - we don't pass items here, we add them after
      // to properly track them in our itemsMapRef
      // Filter out undefined values to avoid passing explicit undefined to Muuri,
      // which can cause errors (e.g., dragPlaceholder: undefined throws when dragging)
      const rawOptions: GridOptions = {
        items: [],
        layout,
        layoutOnResize,
        layoutOnInit,
        layoutDuration,
        layoutEasing,
        showDuration,
        showEasing,
        hideDuration,
        hideEasing,
        visibleStyles,
        hiddenStyles,
        dragEnabled,
        dragContainer,
        dragHandle,
        dragAxis,
        dragSort,
        dragStartPredicate,
        dragSortHeuristics,
        dragSortPredicate,
        dragRelease,
        dragCssProps,
        dragPlaceholder,
        dragAutoScroll,
        sortData,
        containerClass,
        itemClass,
        itemVisibleClass,
        itemHiddenClass,
        itemPositioningClass,
        itemDraggingClass,
        itemReleasingClass,
        itemPlaceholderClass,
      };

      // Strip undefined values - Muuri expects properties to be absent rather than undefined
      const options = Object.fromEntries(
        Object.entries(rawOptions).filter(([, v]) => v !== undefined)
      ) as GridOptions;

      // Create Muuri instance
      muuriInstance = new MuuriClass(containerRef.current, options);

      // Bind event listeners
      muuriInstance.on('layoutStart', (items, isInstant) => {
        callbacksRef.current.onLayoutStart?.(items, isInstant);
      });

      muuriInstance.on('layoutEnd', (items) => {
        callbacksRef.current.onLayoutEnd?.(items);
      });

      muuriInstance.on('add', (items) => {
        callbacksRef.current.onAdd?.(items);
      });

      muuriInstance.on('remove', (items, indices) => {
        callbacksRef.current.onRemove?.(items, indices);
      });

      muuriInstance.on('showEnd', (items) => {
        callbacksRef.current.onShow?.(items);
      });

      muuriInstance.on('hideEnd', (items) => {
        callbacksRef.current.onHide?.(items);
      });

      muuriInstance.on('filter', (shownItems, hiddenItems) => {
        callbacksRef.current.onFilter?.(shownItems, hiddenItems);
      });

      muuriInstance.on('sort', (currentOrder, previousOrder) => {
        callbacksRef.current.onSort?.(currentOrder, previousOrder);
      });

      muuriInstance.on('move', (data) => {
        callbacksRef.current.onMove?.(data);
      });

      muuriInstance.on('dragInit', (item, event) => {
        callbacksRef.current.onDragInit?.(item, event);
      });

      muuriInstance.on('dragStart', (item, event) => {
        callbacksRef.current.onDragStart?.(item, event);
      });

      muuriInstance.on('dragMove', (item, event) => {
        callbacksRef.current.onDragMove?.(item, event);
      });

      muuriInstance.on('dragEnd', (item, event) => {
        callbacksRef.current.onDragEnd?.(item, event);
      });

      muuriInstance.on('dragReleaseStart', (item) => {
        callbacksRef.current.onDragReleaseStart?.(item);
      });

      muuriInstance.on('dragReleaseEnd', (item) => {
        callbacksRef.current.onDragReleaseEnd?.(item);
      });

      muuriInstance.on('send', (data) => {
        callbacksRef.current.onSend?.(data);
      });

      muuriInstance.on('receive', (data) => {
        callbacksRef.current.onReceive?.(data);
      });

      // Add any items that were registered before Muuri initialized
      if (initialItems.length > 0 && !isCancelled) {
        muuriInstance.add(initialItems, { layout: false });
        // Update itemsMapRef with the Muuri items
        const muuriItems = muuriInstance.getItems();
        for (const [, registration] of itemsMapRef.current.entries()) {
          const muuriItem = muuriItems.find((mi) => mi.getElement() === registration.element);
          if (muuriItem) {
            registration.item = muuriItem;
          }
        }
        // Trigger layout after adding items
        muuriInstance.layout();
      }

      if (!isCancelled) {
        isInitializedRef.current = true;
        setGrid(muuriInstance);
      }
    };

    initMuuri();

    return () => {
      isCancelled = true;
      if (muuriInstance) {
        muuriInstance.destroy();
        muuriInstance = null;
      }
      isInitializedRef.current = false;
    };
    // We intentionally don't include all props as dependencies
    // because Muuri options are only used at initialization
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Register item with grid
  const registerItem = useCallback(
    (element: HTMLElement, key: string): Item | null => {
      // Check if already registered
      const existing = itemsMapRef.current.get(key);
      if (existing) {
        // Already registered, return existing item
        return existing.item;
      }

      // Store in map
      itemsMapRef.current.set(key, { element, item: null });

      if (grid && isInitializedRef.current) {
        // Check if element is already a Muuri item (added during initialization)
        const existingItem = grid.getItem(element);
        if (existingItem) {
          const registration = itemsMapRef.current.get(key);
          if (registration) {
            registration.item = existingItem;
          }
          return existingItem;
        }

        // Grid is ready, add directly
        const items = grid.add(element, { layout: true });
        if (items.length > 0) {
          const registration = itemsMapRef.current.get(key);
          if (registration) {
            registration.item = items[0];
          }
          return items[0];
        }
      } else {
        // Grid not ready, queue for initialization
        pendingItemsRef.current.push(element);
      }

      return null;
    },
    [grid]
  );

  // Unregister item from grid
  const unregisterItem = useCallback(
    (key: string): void => {
      const registration = itemsMapRef.current.get(key);
      if (registration) {
        if (registration.item && grid) {
          const itemToRemove = registration.item;
          // Hide the item instantly (no animation since React is unmounting)
          grid.hide([itemToRemove], { instant: true });
          // Remove the item from Muuri's tracking and trigger layout
          // so remaining items reposition to fill the gap
          grid.remove([itemToRemove], { removeElements: false, layout: true });
        } else {
          // Remove from pending if not yet added
          const index = pendingItemsRef.current.indexOf(registration.element);
          if (index > -1) {
            pendingItemsRef.current.splice(index, 1);
          }
        }
        itemsMapRef.current.delete(key);
      }
    },
    [grid]
  );

  // Context value
  const contextValue = useMemo<MuuriContextValue>(
    () => ({
      grid,
      registerItem,
      unregisterItem,
    }),
    [grid, registerItem, unregisterItem]
  );

  // Merge styles - grid needs position: relative
  const mergedStyle = useMemo<CSSProperties>(
    () => ({
      position: 'relative',
      ...style,
    }),
    [style]
  );

  // Merge classNames
  const mergedClassName = useMemo(() => {
    const classes = [containerClass];
    if (className) classes.push(className);
    return classes.join(' ');
  }, [containerClass, className]);

  return (
    <MuuriContext.Provider value={contextValue}>
      <div ref={containerRef} className={mergedClassName} style={mergedStyle} {...htmlProps}>
        {children}
      </div>
    </MuuriContext.Provider>
  );
});

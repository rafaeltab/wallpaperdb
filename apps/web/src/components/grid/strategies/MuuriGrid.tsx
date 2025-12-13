import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  MuuriGrid as MuuriGridComponent,
  MuuriItem,
  useRefresh,
  type LayoutFunction,
} from '@wallpaperdb/react-muuri';
import type { GridProps, GridItem, ItemSpan } from '../types';
import { WallpaperCard } from '../WallpaperCard';
import {
  getDefaultSpan,
  getExpandedSpan,
  calculateExpandedDimensions,
  DEFAULT_EXPANSION_CONFIG,
} from '../utils';

/**
 * Layout state stored in a ref so the layout function can read current values
 * without needing to be recreated (Muuri only uses layout function from init)
 */
interface LayoutState {
  expandedItemKey: string | null;
  viewportCenter: { x: number; y: number } | null;
}

interface GridItemWrapperProps {
  item: GridItem;
  isExpanded: boolean;
  span: ItemSpan;
  width: number;
  height: number;
  margin: number;
  ItemRenderer: React.ComponentType<{
    item: GridItem;
    isExpanded: boolean;
    span: ItemSpan;
    onClick: () => void;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
  }>;
  onClick: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

/**
 * Inner wrapper component that has access to Muuri hooks.
 * Triggers layout recalculation when item size changes.
 */
function GridItemWrapper({
  item,
  isExpanded,
  span,
  width,
  height,
  margin,
  ItemRenderer,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: GridItemWrapperProps) {
  const { refresh } = useRefresh();
  const prevSizeRef = useRef({ width, height });

  // Trigger layout when size changes
  useEffect(() => {
    if (
      prevSizeRef.current.width !== width ||
      prevSizeRef.current.height !== height
    ) {
      refresh();
      prevSizeRef.current = { width, height };
    }
  }, [width, height, refresh]);

  // Track animated content dimensions (starts at target, animates on change)
  const contentWidth = width - margin * 2;
  const contentHeight = height - margin * 2;

  const [animatedSize, setAnimatedSize] = useState({
    width: contentWidth,
    height: contentHeight,
  });
  const isFirstRender = useRef(true);

  // When target size changes, trigger animation
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    // Small delay to ensure the outer container has resized first
    const timer = requestAnimationFrame(() => {
      setAnimatedSize({ width: contentWidth, height: contentHeight });
    });

    return () => cancelAnimationFrame(timer);
  }, [contentWidth, contentHeight]);

  return (
    <div
      style={{
        width,
        height,
        padding: margin,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: animatedSize.width,
          height: animatedSize.height,
          transition: 'width 300ms ease-out, height 300ms ease-out',
        }}
      >
        <ItemRenderer
          item={item}
          isExpanded={isExpanded}
          span={span}
          onClick={onClick}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
        />
      </div>
    </div>
  );
}

/**
 * Rectangle representing free space in the grid.
 * Used for bin-packing algorithm.
 */
interface FreeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Simple bin-packing layout using the "maxrects" approach.
 * This mimics Muuri's default "First Fit" algorithm.
 *
 * @param items - Array of items with getWidth() and getHeight() methods
 * @param gridWidth - Total width of the grid container
 * @param excludeRect - Optional rectangle to exclude (for expanded item)
 * @returns Array of [x, y] positions for each item
 */
function binPackLayout(
  items: Array<{ getWidth: () => number; getHeight: () => number }>,
  gridWidth: number,
  excludeRect?: { x: number; y: number; width: number; height: number } | null
): number[] {
  const slots: number[] = [];

  // Track free rectangles - start with the entire grid (infinite height)
  let freeRects: FreeRect[] = [{ x: 0, y: 0, width: gridWidth, height: Infinity }];

  // If there's an excluded rect (expanded item), remove that space from free rects
  if (excludeRect) {
    freeRects = subtractRect(freeRects, excludeRect);
  }

  for (const item of items) {
    const itemWidth = item.getWidth();
    const itemHeight = item.getHeight();

    // Find the best position (First Fit - lowest Y, then lowest X)
    let bestRect: FreeRect | null = null;
    let bestY = Infinity;
    let bestX = Infinity;

    for (const rect of freeRects) {
      if (rect.width >= itemWidth && rect.height >= itemHeight) {
        // This rect can fit the item
        if (rect.y < bestY || (rect.y === bestY && rect.x < bestX)) {
          bestY = rect.y;
          bestX = rect.x;
          bestRect = rect;
        }
      }
    }

    if (bestRect) {
      // Place item at top-left of the best rect
      slots.push(bestRect.x, bestRect.y);

      // Remove the used space and split remaining space
      const usedRect = {
        x: bestRect.x,
        y: bestRect.y,
        width: itemWidth,
        height: itemHeight,
      };
      freeRects = subtractRect(freeRects, usedRect);
    } else {
      // Fallback: place at bottom of grid (shouldn't happen with infinite height)
      const maxY = freeRects.reduce((max, r) => Math.max(max, r.y), 0);
      slots.push(0, maxY);
    }
  }

  return slots;
}

/**
 * Subtract a rectangle from a list of free rectangles.
 * Returns new free rectangles representing remaining space.
 */
function subtractRect(freeRects: FreeRect[], used: FreeRect): FreeRect[] {
  const result: FreeRect[] = [];

  for (const rect of freeRects) {
    // Check if rectangles overlap
    if (
      used.x >= rect.x + rect.width ||
      used.x + used.width <= rect.x ||
      used.y >= rect.y + rect.height ||
      used.y + used.height <= rect.y
    ) {
      // No overlap, keep original rect
      result.push(rect);
      continue;
    }

    // Split the rect into up to 4 pieces around the used area

    // Left piece
    if (used.x > rect.x) {
      result.push({
        x: rect.x,
        y: rect.y,
        width: used.x - rect.x,
        height: rect.height,
      });
    }

    // Right piece
    if (used.x + used.width < rect.x + rect.width) {
      result.push({
        x: used.x + used.width,
        y: rect.y,
        width: rect.x + rect.width - (used.x + used.width),
        height: rect.height,
      });
    }

    // Top piece
    if (used.y > rect.y) {
      result.push({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: used.y - rect.y,
      });
    }

    // Bottom piece
    if (used.y + used.height < rect.y + rect.height) {
      result.push({
        x: rect.x,
        y: used.y + used.height,
        width: rect.width,
        height: rect.y + rect.height - (used.y + used.height),
      });
    }
  }

  // Remove redundant rectangles (fully contained in others)
  return pruneRects(result);
}

/**
 * Remove rectangles that are fully contained within other rectangles.
 */
function pruneRects(rects: FreeRect[]): FreeRect[] {
  const result: FreeRect[] = [];

  for (let i = 0; i < rects.length; i++) {
    let isContained = false;

    for (let j = 0; j < rects.length; j++) {
      if (i !== j && isRectContained(rects[i], rects[j])) {
        isContained = true;
        break;
      }
    }

    if (!isContained) {
      result.push(rects[i]);
    }
  }

  return result;
}

/**
 * Check if rect A is fully contained within rect B.
 */
function isRectContained(a: FreeRect, b: FreeRect): boolean {
  return (
    a.x >= b.x &&
    a.y >= b.y &&
    a.x + a.width <= b.x + b.width &&
    a.y + a.height <= b.y + b.height
  );
}

/**
 * Creates a custom layout function that reads from a ref for current state.
 * Uses bin-packing algorithm similar to Muuri's default.
 */
function createRefBasedLayout(
  layoutStateRef: React.RefObject<LayoutState>
): LayoutFunction {
  return (_grid, layoutId, items, gridWidth, _gridHeight, callback) => {
    // Read current state from ref
    const { expandedItemKey, viewportCenter } = layoutStateRef.current;

    // Find the expanded item by checking the element's data attribute
    let expandedItem: (typeof items)[number] | null = null;
    let expandedIndex = -1;

    if (expandedItemKey) {
      for (let i = 0; i < items.length; i++) {
        const element = items[i].getElement();
        if (element?.querySelector(`[data-item-id="${expandedItemKey}"]`)) {
          expandedItem = items[i];
          expandedIndex = i;
          break;
        }
      }
    }

    // Calculate expanded item position (centered in viewport)
    let expandedRect: FreeRect | null = null;

    if (expandedItem && viewportCenter) {
      const expandedWidth = expandedItem.getWidth();
      const expandedHeight = expandedItem.getHeight();

      // Center the item at viewport center
      let expandedX = viewportCenter.x - expandedWidth / 2;
      const expandedY = viewportCenter.y - expandedHeight / 2;

      // Keep within grid bounds (horizontally)
      if (expandedX < 0) expandedX = 0;
      if (expandedX + expandedWidth > gridWidth) {
        expandedX = gridWidth - expandedWidth;
      }

      expandedRect = {
        x: expandedX,
        y: Math.max(0, expandedY),
        width: expandedWidth,
        height: expandedHeight,
      };
    }

    // Separate expanded item from others for layout
    const otherItems = items.filter((_, i) => i !== expandedIndex);

    // Use bin-packing for other items, excluding expanded item's space
    const otherSlots = binPackLayout(otherItems, gridWidth, expandedRect);

    // Build final slots array in original order
    const slots: number[] = [];
    let otherIndex = 0;

    for (let i = 0; i < items.length; i++) {
      if (i === expandedIndex && expandedRect) {
        slots.push(expandedRect.x, expandedRect.y);
      } else {
        slots.push(otherSlots[otherIndex * 2], otherSlots[otherIndex * 2 + 1]);
        otherIndex++;
      }
    }

    // Center content horizontally by calculating actual width and adding offset
    let maxRightEdge = 0;
    for (let i = 0; i < items.length; i++) {
      const x = slots[i * 2];
      const itemWidth = items[i].getWidth();
      maxRightEdge = Math.max(maxRightEdge, x + itemWidth);
    }
    const centerOffset = Math.max(0, (gridWidth - maxRightEdge) / 2);

    // Apply offset to all X positions
    for (let i = 0; i < slots.length; i += 2) {
      slots[i] += centerOffset;
    }

    callback({
      id: layoutId,
      items,
      slots,
      styles: null,
    });
  };
}

/**
 * MuuriGrid - A grid layout component using the Muuri layout engine.
 *
 * Features:
 * - Animated layout transitions
 * - Bin-packing algorithm for optimal space usage
 * - Click-to-expand functionality with center positioning
 * - Aspect ratio-based item spanning
 * - Single item expansion only
 */
export function MuuriGrid({
  items,
  baseSize = 250,
  gap = 16,
  getSpan = getDefaultSpan,
  ItemRenderer = WallpaperCard,
  onItemClick,
  onItemHover,
  onItemLeave,
}: GridProps) {
  // Single expanded item state (only one at a time)
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedCenter, setExpandedCenter] = useState<{ x: number; y: number } | null>(null);

  // Layout state ref - the layout function reads from this
  // This allows us to change layout behavior without recreating the function
  const layoutStateRef = useRef<LayoutState>({
    expandedItemKey: null,
    viewportCenter: null,
  });

  // Update ref synchronously during render (before children's effects run)
  // This ensures the layout function sees the current state when refresh() is called
  layoutStateRef.current = {
    expandedItemKey: expandedId,
    viewportCenter: expandedCenter,
  };

  // Create stable layout function once (reads from ref for current state)
  const customLayout = useMemo(
    () => createRefBasedLayout(layoutStateRef),
    []
  );

  // Track container width and viewport height for capping expanded items
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : 1200
  );
  const [viewportHeight, setViewportHeight] = useState(
    typeof window !== 'undefined' ? window.innerHeight : 800
  );

  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.offsetWidth);
      }
      setViewportHeight(window.innerHeight);
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  const handleClick = useCallback(
    (item: GridItem) => {
      if (expandedId === item.id) {
        // Clicking expanded item → collapse it
        setExpandedId(null);
        setExpandedCenter(null);
      } else {
        // Clicking any other item → expand it (auto-collapses previous)
        const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
        const centerX = containerWidth / 2;

        // Calculate viewport center relative to grid container (not document coordinates)
        const containerRect = containerRef.current?.getBoundingClientRect();
        const centerY = containerRect
          ? viewportHeight / 2 - containerRect.top
          : viewportHeight / 2;

        setExpandedId(item.id);
        setExpandedCenter({ x: centerX, y: centerY });
      }

      onItemClick?.(item);
    },
    [expandedId, containerWidth, onItemClick]
  );

  const handleMouseEnter = useCallback(
    (item: GridItem) => {
      console.log('Hover:', item.id, { aspectRatio: item.aspectRatio });
      onItemHover?.(item);
    },
    [onItemHover]
  );

  const handleMouseLeave = useCallback(
    (item: GridItem) => {
      onItemLeave?.(item);
    },
    [onItemLeave]
  );

  const getItemSpan = useCallback(
    (item: GridItem): ItemSpan => {
      const baseSpan = getSpan(item);
      if (expandedId === item.id) {
        return getExpandedSpan(baseSpan);
      }
      return baseSpan;
    },
    [getSpan, expandedId]
  );

  // Calculate pixel dimensions from span and aspect ratio
  const getItemDimensions = useCallback(
    (
      item: GridItem,
      span: ItemSpan,
      isExpanded: boolean,
      containerW: number,
      viewportH: number,
    ) => {
      // Base dimensions from span columns
      let width = span.cols * baseSize;
      let height = width / item.aspectRatio;

      // Apply area-based expansion with dimension caps
      if (isExpanded) {
        const config = DEFAULT_EXPANSION_CONFIG;

        // Calculate max constraints:
        // 1. Viewport/container based limits
        // 2. Image's native resolution (don't upscale beyond original)
        const maxWidth = Math.min(
          containerW * config.maxWidthFraction - gap,
          item.width,
        );
        const maxHeight = Math.min(
          viewportH * config.maxHeightFraction,
          item.height,
        );

        // Use area-based algorithm for visually consistent expansion
        const expanded = calculateExpandedDimensions(
          width,
          height,
          item.aspectRatio,
          maxWidth,
          maxHeight,
          config.areaMultiplier,
        );

        width = expanded.width;
        height = expanded.height;
      }

      // Add margin (half gap on each side = full gap between items)
      const margin = gap / 2;
      return {
        width: width + gap,
        height: height + gap,
        margin,
      };
    },
    [baseSize, gap],
  );

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      <MuuriGridComponent
        layout={customLayout}
        layoutDuration={300}
        layoutEasing="ease-out"
        style={{ position: 'relative', width: '100%' }}
      >
        {items.map((item) => {
          const isExpanded = expandedId === item.id;
          const span = getItemSpan(item);
          const { width, height, margin } = getItemDimensions(
            item,
            span,
            isExpanded,
            containerWidth,
            viewportHeight,
          );

          return (
            <MuuriItem key={item.id}>
              <div data-item-id={item.id} style={{ width: '100%', height: '100%' }}>
                <GridItemWrapper
                  item={item}
                  isExpanded={isExpanded}
                  span={span}
                  width={width}
                  height={height}
                  margin={margin}
                  ItemRenderer={ItemRenderer}
                  onClick={() => handleClick(item)}
                  onMouseEnter={() => handleMouseEnter(item)}
                  onMouseLeave={() => handleMouseLeave(item)}
                />
              </div>
            </MuuriItem>
          );
        })}
      </MuuriGridComponent>
    </div>
  );
}

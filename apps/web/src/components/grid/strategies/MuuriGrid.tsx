import { MuuriGrid as MuuriGridComponent, MuuriItem, useRefresh } from '@wallpaperdb/react-muuri';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createMuuriLayout, type GridLayoutState } from '@/features/grid-layout/adapters/muuri';
import type { GridItem, GridProps, ItemSpan } from '../types';
import {
  gridCellSize,
  gridItemDimensions,
  getDefaultSpan,
  getExpandedSpan,
} from '@/features/grid-layout';
import { WallpaperCard } from '../WallpaperCard';

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
    if (prevSizeRef.current.width !== width || prevSizeRef.current.height !== height) {
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
  const layoutStateRef = useRef<GridLayoutState>({
    expandedItemKey: null,
    viewportCenter: null,
    marginOffset: gap / 2,
  });

  // Create stable layout function once (reads from ref for current state)
  const customLayout = useMemo(() => createMuuriLayout(() => layoutStateRef.current), []);

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

  const numColumns = Math.max(1, Math.floor((containerWidth - gap) / (baseSize + gap)));
  const effectiveBaseSize = gridCellSize(containerWidth, baseSize, gap);

  // Update ref synchronously during render (before children's effects run)
  // This ensures the layout function sees the current state when refresh() is called
  layoutStateRef.current = {
    expandedItemKey: expandedId,
    viewportCenter: expandedCenter,
    marginOffset: gap / 2,
  };

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
        const centerY = containerRect ? viewportHeight / 2 - containerRect.top : viewportHeight / 2;

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
      const span = expandedId === item.id ? getExpandedSpan(baseSpan) : baseSpan;
      return { ...span, cols: numColumns === 1 ? 1 : span.cols };
    },
    [getSpan, expandedId, numColumns]
  );

  // Calculate pixel dimensions from span and aspect ratio
  const getItemDimensions = useCallback(
    (
      item: GridItem,
      span: ItemSpan,
      isExpanded: boolean,
      containerW: number,
      viewportH: number
    ) => {
      return gridItemDimensions({
        item,
        span,
        isExpanded,
        cellSize: effectiveBaseSize,
        gap,
        containerWidth: containerW,
        viewportHeight: viewportH,
      });
    },
    [effectiveBaseSize, gap]
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
            viewportHeight
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

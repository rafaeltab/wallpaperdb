import { useState, useCallback, useMemo } from 'react';
import type { GridProps, GridItem, ItemSpan } from '../types';
import { WallpaperCard } from '../WallpaperCard';
import { getDefaultSpan, getExpandedSpan } from '../utils';

/**
 * MuuriGrid - A grid layout component.
 *
 * TODO: Replace CSS Grid implementation with actual Muuri when @wallpaperdb/muuri-react is ready.
 * Current implementation uses CSS Grid with dense packing as a functional placeholder.
 *
 * Features to add when Muuri is integrated:
 * - Animated layout transitions
 * - Drag-and-drop reordering
 * - Filtering and sorting animations
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
  expandedItems = new Set(),
}: GridProps) {
  const [localExpandedItems, setLocalExpandedItems] = useState<Set<string>>(
    () => new Set(expandedItems)
  );

  // Merge external and local expanded state
  const allExpandedItems = useMemo(() => {
    const merged = new Set(expandedItems);
    for (const id of localExpandedItems) {
      merged.add(id);
    }
    return merged;
  }, [expandedItems, localExpandedItems]);

  const handleClick = useCallback(
    (item: GridItem) => {
      // Toggle expanded state
      setLocalExpandedItems((prev) => {
        const next = new Set(prev);
        if (next.has(item.id)) {
          next.delete(item.id);
        } else {
          next.add(item.id);
        }
        return next;
      });

      onItemClick?.(item);
    },
    [onItemClick]
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
      if (allExpandedItems.has(item.id)) {
        return getExpandedSpan(baseSpan);
      }
      return baseSpan;
    },
    [getSpan, allExpandedItems]
  );

  return (
    <div
      className="grid w-full"
      style={{
        gridTemplateColumns: `repeat(auto-fill, minmax(${baseSize}px, 1fr))`,
        gridAutoRows: `${baseSize}px`,
        gridAutoFlow: 'dense',
        gap: `${gap}px`,
      }}
    >
      {items.map((item) => {
        const isExpanded = allExpandedItems.has(item.id);
        const span = getItemSpan(item);

        return (
          <div
            key={item.id}
            className="transition-all duration-300 ease-in-out"
            style={{
              gridColumn: `span ${span.cols}`,
              gridRow: `span ${span.rows}`,
            }}
          >
            <ItemRenderer
              item={item}
              isExpanded={isExpanded}
              span={span}
              onClick={() => handleClick(item)}
              onMouseEnter={() => handleMouseEnter(item)}
              onMouseLeave={() => handleMouseLeave(item)}
            />
          </div>
        );
      })}
    </div>
  );
}

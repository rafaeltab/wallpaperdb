'use client';

import { useContext, useEffect, useMemo, useState } from 'react';
import { ItemContext } from '../context/ItemContext.js';
import { MuuriContext } from '../context/MuuriContext.js';
import type { UseDragReturn } from '../types/index.js';
import { createDragEventBridge } from '../utils/event-bridge.js';

/**
 * Hook to access the drag state of the current Muuri item.
 * Must be used inside a MuuriItem component.
 *
 * @returns Object containing isDragging and isReleasing flags
 *
 * @example
 * ```tsx
 * function DraggableCard({ children }) {
 *   const { isDragging, isReleasing } = useDrag();
 *
 *   return (
 *     <div
 *       className={isDragging ? 'dragging' : ''}
 *       style={{ opacity: isDragging ? 0.5 : 1 }}
 *     >
 *       {children}
 *       {isReleasing && <span>Releasing...</span>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useDrag(): UseDragReturn {
  const muuriContext = useContext(MuuriContext);
  const itemContext = useContext(ItemContext);

  const grid = muuriContext?.grid ?? null;
  const item = itemContext?.item ?? null;

  const [isDragging, setIsDragging] = useState(false);
  const [isReleasing, setIsReleasing] = useState(false);

  // Subscribe to drag events via event bridge
  useEffect(() => {
    if (!grid || !item) return;

    // Initialize state from item
    setIsDragging(item.isDragging());
    setIsReleasing(item.isReleasing());

    // Create event bridge for drag events
    const cleanup = createDragEventBridge(grid, item, {
      onDragStart: () => setIsDragging(true),
      onDragEnd: () => setIsDragging(false),
      onReleaseStart: () => setIsReleasing(true),
      onReleaseEnd: () => setIsReleasing(false),
    });

    return cleanup;
  }, [grid, item]);

  return useMemo(
    () => ({
      isDragging,
      isReleasing,
    }),
    [isDragging, isReleasing]
  );
}

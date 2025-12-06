'use client';

import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ItemContext } from '../context/ItemContext.js';
import { MuuriContext } from '../context/MuuriContext.js';
import type { UseItemReturn } from '../types/index.js';

/**
 * Hook to access the current Muuri item and its state.
 * Must be used inside a MuuriItem component.
 *
 * @returns Object containing item instance and state flags
 *
 * @example
 * ```tsx
 * function Card({ children }) {
 *   const { isDragging, isVisible, isPositioning } = useItem();
 *
 *   return (
 *     <div className={isDragging ? 'dragging' : ''}>
 *       {children}
 *       {isPositioning && <Spinner />}
 *     </div>
 *   );
 * }
 * ```
 */
export function useItem(): UseItemReturn {
  const muuriContext = useContext(MuuriContext);
  const itemContext = useContext(ItemContext);

  const item = itemContext?.item ?? null;
  const grid = muuriContext?.grid ?? null;

  // State for item flags - default to false when outside context
  // isVisible defaults to true only when we have an item, since items are visible by default
  const [isDragging, setIsDragging] = useState(false);
  const [isPositioning, setIsPositioning] = useState(false);
  const [isVisible, setIsVisible] = useState(() => (item ? item.isVisible() : false));
  const [isShowing, setIsShowing] = useState(false);
  const [isHiding, setIsHiding] = useState(false);
  const [isReleasing, setIsReleasing] = useState(false);

  // Update state from item methods when available
  const updateState = useCallback(() => {
    if (item) {
      setIsDragging(item.isDragging());
      setIsPositioning(item.isPositioning());
      setIsVisible(item.isVisible());
      setIsShowing(item.isShowing());
      setIsHiding(item.isHiding());
      setIsReleasing(item.isReleasing());
    }
  }, [item]);

  // Subscribe to grid events that affect item state
  useEffect(() => {
    if (!grid || !item) return;

    // Initial state update
    updateState();

    // Event handlers that update state
    const handleDragStart = (_draggedItem: unknown) => {
      if (_draggedItem === item) {
        setIsDragging(true);
      }
    };

    const handleDragEnd = (_draggedItem: unknown) => {
      if (_draggedItem === item) {
        setIsDragging(false);
      }
    };

    const handleDragReleaseStart = (_releasedItem: unknown) => {
      if (_releasedItem === item) {
        setIsReleasing(true);
      }
    };

    const handleDragReleaseEnd = (_releasedItem: unknown) => {
      if (_releasedItem === item) {
        setIsReleasing(false);
      }
    };

    const handleShowStart = (items: unknown[]) => {
      if (items.includes(item)) {
        setIsShowing(true);
        setIsVisible(true);
      }
    };

    const handleShowEnd = (items: unknown[]) => {
      if (items.includes(item)) {
        setIsShowing(false);
      }
    };

    const handleHideStart = (items: unknown[]) => {
      if (items.includes(item)) {
        setIsHiding(true);
      }
    };

    const handleHideEnd = (items: unknown[]) => {
      if (items.includes(item)) {
        setIsHiding(false);
        setIsVisible(false);
      }
    };

    const handleLayoutStart = (items: unknown[]) => {
      if (items.includes(item)) {
        setIsPositioning(true);
      }
    };

    const handleLayoutEnd = (items: unknown[]) => {
      if (items.includes(item)) {
        setIsPositioning(false);
      }
    };

    // Subscribe to events
    grid.on('dragStart', handleDragStart);
    grid.on('dragEnd', handleDragEnd);
    grid.on('dragReleaseStart', handleDragReleaseStart);
    grid.on('dragReleaseEnd', handleDragReleaseEnd);
    grid.on('showStart', handleShowStart);
    grid.on('showEnd', handleShowEnd);
    grid.on('hideStart', handleHideStart);
    grid.on('hideEnd', handleHideEnd);
    grid.on('layoutStart', handleLayoutStart);
    grid.on('layoutEnd', handleLayoutEnd);

    return () => {
      grid.off('dragStart', handleDragStart);
      grid.off('dragEnd', handleDragEnd);
      grid.off('dragReleaseStart', handleDragReleaseStart);
      grid.off('dragReleaseEnd', handleDragReleaseEnd);
      grid.off('showStart', handleShowStart);
      grid.off('showEnd', handleShowEnd);
      grid.off('hideStart', handleHideStart);
      grid.off('hideEnd', handleHideEnd);
      grid.off('layoutStart', handleLayoutStart);
      grid.off('layoutEnd', handleLayoutEnd);
    };
  }, [grid, item, updateState]);

  return useMemo(
    () => ({
      item,
      isDragging,
      isPositioning,
      isVisible,
      isShowing,
      isHiding,
      isReleasing,
    }),
    [item, isDragging, isPositioning, isVisible, isShowing, isHiding, isReleasing]
  );
}

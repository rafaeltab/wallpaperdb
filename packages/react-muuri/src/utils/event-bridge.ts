'use client';

import type { MuuriInstance, MuuriItem } from '../types/index.js';

/**
 * Cleanup function returned by event bridges
 */
export type EventBridgeCleanup = () => void;

/**
 * Callbacks for drag events
 */
export interface DragEventCallbacks {
  onDragStart: () => void;
  onDragEnd: () => void;
  onReleaseStart: () => void;
  onReleaseEnd: () => void;
}

/**
 * Callbacks for visibility events
 */
export interface VisibilityEventCallbacks {
  onShowStart: () => void;
  onShowEnd: () => void;
  onHideStart: () => void;
  onHideEnd: () => void;
}

/**
 * Creates an event bridge for drag-related events.
 * Subscribes to Muuri drag events and calls callbacks only for the target item.
 *
 * @param grid - The Muuri grid instance
 * @param item - The target item to track
 * @param callbacks - Callbacks for drag events
 * @returns Cleanup function to unsubscribe from events
 */
export function createDragEventBridge(
  grid: MuuriInstance,
  item: MuuriItem,
  callbacks: DragEventCallbacks
): EventBridgeCleanup {
  const handleDragStart = (draggedItem: MuuriItem) => {
    if (draggedItem === item) {
      callbacks.onDragStart();
    }
  };

  const handleDragEnd = (draggedItem: MuuriItem) => {
    if (draggedItem === item) {
      callbacks.onDragEnd();
    }
  };

  const handleReleaseStart = (releasedItem: MuuriItem) => {
    if (releasedItem === item) {
      callbacks.onReleaseStart();
    }
  };

  const handleReleaseEnd = (releasedItem: MuuriItem) => {
    if (releasedItem === item) {
      callbacks.onReleaseEnd();
    }
  };

  // Subscribe to events
  grid.on('dragStart', handleDragStart);
  grid.on('dragEnd', handleDragEnd);
  grid.on('dragReleaseStart', handleReleaseStart);
  grid.on('dragReleaseEnd', handleReleaseEnd);

  // Return cleanup function
  return () => {
    grid.off('dragStart', handleDragStart);
    grid.off('dragEnd', handleDragEnd);
    grid.off('dragReleaseStart', handleReleaseStart);
    grid.off('dragReleaseEnd', handleReleaseEnd);
  };
}

/**
 * Creates an event bridge for visibility-related events.
 * Subscribes to Muuri show/hide events and calls callbacks only for the target item.
 *
 * @param grid - The Muuri grid instance
 * @param item - The target item to track
 * @param callbacks - Callbacks for visibility events
 * @returns Cleanup function to unsubscribe from events
 */
export function createVisibilityEventBridge(
  grid: MuuriInstance,
  item: MuuriItem,
  callbacks: VisibilityEventCallbacks
): EventBridgeCleanup {
  const handleShowStart = (items: MuuriItem[]) => {
    if (items.includes(item)) {
      callbacks.onShowStart();
    }
  };

  const handleShowEnd = (items: MuuriItem[]) => {
    if (items.includes(item)) {
      callbacks.onShowEnd();
    }
  };

  const handleHideStart = (items: MuuriItem[]) => {
    if (items.includes(item)) {
      callbacks.onHideStart();
    }
  };

  const handleHideEnd = (items: MuuriItem[]) => {
    if (items.includes(item)) {
      callbacks.onHideEnd();
    }
  };

  // Subscribe to events
  grid.on('showStart', handleShowStart);
  grid.on('showEnd', handleShowEnd);
  grid.on('hideStart', handleHideStart);
  grid.on('hideEnd', handleHideEnd);

  // Return cleanup function
  return () => {
    grid.off('showStart', handleShowStart);
    grid.off('showEnd', handleShowEnd);
    grid.off('hideStart', handleHideStart);
    grid.off('hideEnd', handleHideEnd);
  };
}

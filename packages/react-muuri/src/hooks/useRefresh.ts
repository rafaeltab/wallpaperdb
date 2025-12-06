'use client';

import { useCallback, useContext, useMemo } from 'react';
import { ItemContext } from '../context/ItemContext.js';
import { MuuriContext } from '../context/MuuriContext.js';
import type { UseRefreshReturn } from '../types/index.js';

/**
 * Hook to refresh the current item's dimensions in the Muuri grid.
 * Must be used inside a MuuriItem component for item-specific refresh.
 *
 * @returns Object containing refresh function
 *
 * @example
 * ```tsx
 * function ResizableCard({ children }) {
 *   const { refresh } = useRefresh();
 *
 *   const handleResize = () => {
 *     // After the card resizes
 *     refresh();
 *   };
 *
 *   return <Resizable onResize={handleResize}>{children}</Resizable>;
 * }
 * ```
 */
export function useRefresh(): UseRefreshReturn {
  const muuriContext = useContext(MuuriContext);
  const itemContext = useContext(ItemContext);

  const grid = muuriContext?.grid ?? null;
  const item = itemContext?.item ?? null;

  const refresh = useCallback(
    (force?: boolean): void => {
      if (!grid) return;

      if (item) {
        // Refresh only this item
        grid.refreshItems([item], force);
      } else {
        // If no item context, refresh all items
        grid.refreshItems(grid.getItems(), force);
      }

      // Trigger layout after refresh
      grid.layout();
    },
    [grid, item]
  );

  return useMemo(() => ({ refresh }), [refresh]);
}

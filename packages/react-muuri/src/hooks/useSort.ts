'use client';

import { useCallback, useContext, useMemo } from 'react';
import { MuuriContext } from '../context/MuuriContext.js';
import type { MuuriItem, SortComparer, SortOptions, UseSortReturn } from '../types/index.js';

/**
 * Hook to sort items in the Muuri grid.
 *
 * @returns Object containing sort function
 *
 * @example
 * ```tsx
 * function SortControls() {
 *   const { sort } = useSort();
 *
 *   return (
 *     <>
 *       <button onClick={() => sort('data-order')}>
 *         Sort by Order
 *       </button>
 *       <button onClick={() => sort('data-name', { descending: true })}>
 *         Sort by Name (Z-A)
 *       </button>
 *       <button onClick={() => sort((a, b) => a.getWidth() - b.getWidth())}>
 *         Sort by Width
 *       </button>
 *     </>
 *   );
 * }
 * ```
 */
export function useSort(): UseSortReturn {
  const context = useContext(MuuriContext);
  const grid = context?.grid ?? null;

  const sort = useCallback(
    (comparer: string | string[] | SortComparer | MuuriItem[], options?: SortOptions): void => {
      if (!grid) return;
      grid.sort(comparer, options);
    },
    [grid]
  );

  return useMemo(() => ({ sort }), [sort]);
}

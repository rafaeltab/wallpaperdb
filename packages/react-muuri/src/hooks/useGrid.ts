'use client';

import { useCallback, useContext, useMemo } from 'react';
import { MuuriContext } from '../context/MuuriContext.js';
import type {
  FilterOptions,
  FilterPredicate,
  MuuriItem,
  SortComparer,
  SortOptions,
  UseGridReturn,
} from '../types/index.js';

/**
 * Hook to access the Muuri grid instance and its methods.
 *
 * @returns Object containing grid instance and methods (layout, filter, sort, etc.)
 *
 * @example
 * ```tsx
 * function GridControls() {
 *   const { grid, layout, filter, sort } = useGrid();
 *
 *   return (
 *     <>
 *       <button onClick={() => layout()}>Relayout</button>
 *       <button onClick={() => filter(item => item.isActive())}>Show Active</button>
 *       <button onClick={() => sort('data-order')}>Sort by Order</button>
 *     </>
 *   );
 * }
 * ```
 */
export function useGrid(): UseGridReturn {
  const context = useContext(MuuriContext);
  const grid = context?.grid ?? null;

  const getItems = useCallback((): MuuriItem[] => {
    if (!grid) return [];
    return grid.getItems();
  }, [grid]);

  const layout = useCallback(
    (instant?: boolean): void => {
      if (!grid) return;
      grid.layout(instant);
    },
    [grid]
  );

  const filter = useCallback(
    (predicate: string | FilterPredicate, options?: FilterOptions): void => {
      if (!grid) return;
      grid.filter(predicate, options);
    },
    [grid]
  );

  const sort = useCallback(
    (comparer: string | string[] | SortComparer | MuuriItem[], options?: SortOptions): void => {
      if (!grid) return;
      grid.sort(comparer, options);
    },
    [grid]
  );

  const refreshItems = useCallback(
    (items?: MuuriItem[], force?: boolean): void => {
      if (!grid) return;
      const targetItems = items ?? grid.getItems();
      grid.refreshItems(targetItems, force);
    },
    [grid]
  );

  const refreshSortData = useCallback(
    (items?: MuuriItem[]): void => {
      if (!grid) return;
      const targetItems = items ?? grid.getItems();
      grid.refreshSortData(targetItems);
    },
    [grid]
  );

  return useMemo(
    () => ({
      grid,
      getItems,
      layout,
      filter,
      sort,
      refreshItems,
      refreshSortData,
    }),
    [grid, getItems, layout, filter, sort, refreshItems, refreshSortData]
  );
}

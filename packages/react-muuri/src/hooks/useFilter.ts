'use client';

import { useCallback, useContext, useMemo } from 'react';
import { MuuriContext } from '../context/MuuriContext.js';
import type { FilterOptions, FilterPredicate, UseFilterReturn } from '../types/index.js';

/**
 * Hook to filter items in the Muuri grid.
 *
 * @returns Object containing filter function
 *
 * @example
 * ```tsx
 * function FilterControls() {
 *   const { filter } = useFilter();
 *
 *   return (
 *     <>
 *       <button onClick={() => filter('.active')}>
 *         Show Active
 *       </button>
 *       <button onClick={() => filter(item => item.isVisible())}>
 *         Show Visible
 *       </button>
 *       <button onClick={() => filter(() => true)}>
 *         Show All
 *       </button>
 *     </>
 *   );
 * }
 * ```
 */
export function useFilter(): UseFilterReturn {
  const context = useContext(MuuriContext);
  const grid = context?.grid ?? null;

  const filter = useCallback(
    (predicate: string | FilterPredicate, options?: FilterOptions): void => {
      if (!grid) return;
      grid.filter(predicate, options);
    },
    [grid]
  );

  return useMemo(() => ({ filter }), [filter]);
}

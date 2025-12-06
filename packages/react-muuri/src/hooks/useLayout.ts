'use client';

import { useCallback, useContext, useMemo } from 'react';
import { MuuriContext } from '../context/MuuriContext.js';
import type { UseLayoutReturn } from '../types/index.js';

/**
 * Hook to trigger layout recalculation on the Muuri grid.
 *
 * @returns Object containing layout function
 *
 * @example
 * ```tsx
 * function DynamicContent() {
 *   const { layout } = useLayout();
 *
 *   const handleContentChange = () => {
 *     // After content changes size
 *     layout();
 *   };
 *
 *   return <ExpandableContent onChange={handleContentChange} />;
 * }
 * ```
 */
export function useLayout(): UseLayoutReturn {
  const context = useContext(MuuriContext);
  const grid = context?.grid ?? null;

  const layout = useCallback(
    (instant?: boolean): void => {
      if (!grid) return;
      grid.layout(instant);
    },
    [grid]
  );

  return useMemo(() => ({ layout }), [layout]);
}

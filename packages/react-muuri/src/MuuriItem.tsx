'use client';

import {
  forwardRef,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { MuuriContext } from './context/MuuriContext.js';
import { ItemContext } from './context/ItemContext.js';
import type {
  MuuriItem as MuuriItemType,
  MuuriItemProps,
  ItemContextValue,
} from './types/index.js';

/**
 * MuuriItem component - represents a single item in the Muuri grid.
 *
 * This component creates the required two-level DOM structure for Muuri:
 * - Outer element: positioned absolutely by Muuri
 * - Inner element: contains your content
 *
 * @example
 * ```tsx
 * <MuuriItem>
 *   <div className="card">Card content</div>
 * </MuuriItem>
 * ```
 */
export const MuuriItem = forwardRef<HTMLDivElement, MuuriItemProps>(function MuuriItem(
  { children, className, style, itemKey, ...htmlProps },
  ref
) {
  const generatedId = useId();
  const key = itemKey ?? generatedId;
  const elementRef = useRef<HTMLDivElement>(null);
  const [item, setItem] = useState<MuuriItemType | null>(null);
  const muuriContext = useContext(MuuriContext);
  const isRegisteredRef = useRef(false);

  // Register with grid on mount
  useEffect(() => {
    if (!elementRef.current || !muuriContext || isRegisteredRef.current) return;

    isRegisteredRef.current = true;
    const muuriItem = muuriContext.registerItem(elementRef.current, key);
    if (muuriItem) {
      setItem(muuriItem);
    }

    return () => {
      if (isRegisteredRef.current) {
        muuriContext.unregisterItem(key);
        isRegisteredRef.current = false;
      }
    };
  }, [muuriContext, key]);

  // Update item when grid initializes (for items registered before grid was ready)
  useEffect(() => {
    if (muuriContext?.grid && elementRef.current && !item) {
      const muuriItem = muuriContext.grid.getItem(elementRef.current);
      if (muuriItem) {
        setItem(muuriItem);
      }
    }
  }, [muuriContext?.grid, item]);

  // Merge styles - outer element needs position: absolute
  const mergedStyle = useMemo<CSSProperties>(
    () => ({
      position: 'absolute',
      ...style,
    }),
    [style]
  );

  // Item context value
  const itemContextValue = useMemo<ItemContextValue>(
    () => ({
      item,
      itemKey: key,
    }),
    [item, key]
  );

  // Forward ref
  useEffect(() => {
    if (typeof ref === 'function') {
      ref(elementRef.current);
    } else if (ref) {
      ref.current = elementRef.current;
    }
  }, [ref]);

  return (
    <ItemContext.Provider value={itemContextValue}>
      <div ref={elementRef} className={className} style={mergedStyle} {...htmlProps}>
        <div className="muuri-item-content">{children}</div>
      </div>
    </ItemContext.Provider>
  );
});

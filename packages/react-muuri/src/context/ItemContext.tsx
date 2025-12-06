'use client';

import { createContext, useMemo, type ReactNode, useState } from 'react';
import type { ItemContextValue, MuuriItem } from '../types/index.js';

/**
 * Context for sharing item-specific data within a MuuriItem component.
 * Default value is null when used outside of an ItemProvider.
 */
export const ItemContext = createContext<ItemContextValue | null>(null);

ItemContext.displayName = 'ItemContext';

/**
 * Props for the ItemProvider component
 */
export interface ItemProviderProps {
  /** The unique key for this item */
  itemKey: string;
  /** Child components */
  children?: ReactNode;
}

/**
 * Provider component that manages the item context.
 * Used internally by MuuriItem to provide item-specific context to its children.
 */
export function ItemProvider({ itemKey, children }: ItemProviderProps) {
  // Item is null in the basic provider - actual item is set by MuuriItem component
  const item: MuuriItem | null = null;

  const contextValue = useMemo<ItemContextValue>(
    () => ({
      item,
      itemKey,
    }),
    [item, itemKey]
  );

  return <ItemContext.Provider value={contextValue}>{children}</ItemContext.Provider>;
}

/**
 * Internal interface for setting the item instance.
 * Used by MuuriItem to update the context with the Muuri item.
 */
export interface ItemProviderInternalProps extends ItemProviderProps {
  /** Called when the provider needs to set the item instance */
  onItemRef?: (setItem: (item: MuuriItem | null) => void) => void;
}

/**
 * Internal provider that allows MuuriItem to set the item instance.
 */
export function ItemProviderInternal({ itemKey, children, onItemRef }: ItemProviderInternalProps) {
  const [item, setItem] = useState<MuuriItem | null>(null);

  // Expose setItem to parent
  useMemo(() => {
    onItemRef?.(setItem);
  }, [onItemRef]);

  const contextValue = useMemo<ItemContextValue>(
    () => ({
      item,
      itemKey,
    }),
    [item, itemKey]
  );

  return <ItemContext.Provider value={contextValue}>{children}</ItemContext.Provider>;
}

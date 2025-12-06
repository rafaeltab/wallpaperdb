'use client';

import { createContext, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import type { MuuriContextValue, MuuriInstance, MuuriItem } from '../types/index.js';

/**
 * Context for sharing the Muuri grid instance and item management functions.
 * Default value is null when used outside of a MuuriProvider.
 */
export const MuuriContext = createContext<MuuriContextValue | null>(null);

MuuriContext.displayName = 'MuuriContext';

/**
 * Internal state for tracking registered items
 */
interface ItemRegistration {
  element: HTMLElement;
  muuriItem: MuuriItem | null;
}

/**
 * Props for the MuuriProvider component
 */
export interface MuuriProviderProps {
  children?: ReactNode;
}

/**
 * Provider component that manages the Muuri grid context.
 * This is used internally by MuuriGrid to provide context to its children.
 */
export function MuuriProvider({ children }: MuuriProviderProps) {
  /**
   * Register an item element - no-op in basic provider
   */
  const registerItem = useCallback((_element: HTMLElement, _key: string): MuuriItem | null => {
    // No grid in basic provider
    return null;
  }, []);

  /**
   * Unregister an item - no-op in basic provider
   */
  const unregisterItem = useCallback((_key: string): void => {
    // No grid in basic provider
  }, []);

  const contextValue = useMemo<MuuriContextValue>(
    () => ({
      grid: null,
      registerItem,
      unregisterItem,
    }),
    [registerItem, unregisterItem]
  );

  return <MuuriContext.Provider value={contextValue}>{children}</MuuriContext.Provider>;
}

/**
 * Internal interface for setting the grid instance.
 * Used by MuuriGrid to update the context with the Muuri instance.
 */
export interface MuuriProviderInternalProps extends MuuriProviderProps {
  /** Called when the provider needs to set the grid instance */
  onGridRef?: (setGrid: (grid: MuuriInstance | null) => void) => void;
}

/**
 * Internal provider that allows MuuriGrid to set the grid instance.
 */
export function MuuriProviderInternal({ children, onGridRef }: MuuriProviderInternalProps) {
  const [grid, setGrid] = useState<MuuriInstance | null>(null);
  const itemsRef = useRef<Map<string, ItemRegistration>>(new Map());

  // Expose setGrid to parent
  useMemo(() => {
    onGridRef?.(setGrid);
  }, [onGridRef]);

  const registerItem = useCallback(
    (element: HTMLElement, key: string): MuuriItem | null => {
      itemsRef.current.set(key, { element, muuriItem: null });

      if (grid) {
        const items = grid.add(element, { layout: false });
        if (items.length > 0) {
          const registration = itemsRef.current.get(key);
          if (registration) {
            registration.muuriItem = items[0];
          }
          return items[0];
        }
      }

      return null;
    },
    [grid]
  );

  const unregisterItem = useCallback(
    (key: string): void => {
      const registration = itemsRef.current.get(key);
      if (registration?.muuriItem && grid) {
        grid.remove([registration.muuriItem], { removeElements: false, layout: true });
      }
      itemsRef.current.delete(key);
    },
    [grid]
  );

  const contextValue = useMemo<MuuriContextValue>(
    () => ({
      grid,
      registerItem,
      unregisterItem,
    }),
    [grid, registerItem, unregisterItem]
  );

  return <MuuriContext.Provider value={contextValue}>{children}</MuuriContext.Provider>;
}

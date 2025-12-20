import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { MuuriGrid } from '../../src/MuuriGrid.js';
import { MuuriItem } from '../../src/MuuriItem.js';
import { useGrid } from '../../src/hooks/useGrid.js';

describe('useGrid', () => {
  describe('outside MuuriGrid context', () => {
    it('should return null grid when used outside MuuriGrid', () => {
      const { result } = renderHook(() => useGrid());

      expect(result.current.grid).toBeNull();
    });

    it('should return no-op functions when used outside MuuriGrid', () => {
      const { result } = renderHook(() => useGrid());

      // Functions should exist but be no-ops
      expect(result.current.getItems).toBeInstanceOf(Function);
      expect(result.current.layout).toBeInstanceOf(Function);
      expect(result.current.filter).toBeInstanceOf(Function);
      expect(result.current.sort).toBeInstanceOf(Function);
      expect(result.current.refreshItems).toBeInstanceOf(Function);
      expect(result.current.refreshSortData).toBeInstanceOf(Function);
    });

    it('should return empty array from getItems when outside context', () => {
      const { result } = renderHook(() => useGrid());

      expect(result.current.getItems()).toEqual([]);
    });

    it('should not throw when calling methods outside context', () => {
      const { result } = renderHook(() => useGrid());

      expect(() => result.current.layout()).not.toThrow();
      expect(() => result.current.layout(true)).not.toThrow();
      expect(() => result.current.filter(() => true)).not.toThrow();
      expect(() => result.current.sort('data-id')).not.toThrow();
      expect(() => result.current.refreshItems()).not.toThrow();
      expect(() => result.current.refreshSortData()).not.toThrow();
    });
  });

  describe('inside MuuriGrid context', () => {
    function GridWrapper({ children }: { children: ReactNode }) {
      return (
        <MuuriGrid>
          <MuuriItem key="1">
            <div style={{ width: 100, height: 100 }}>Item 1</div>
          </MuuriItem>
          {children}
        </MuuriGrid>
      );
    }

    it('should return grid instance when used inside MuuriGrid', async () => {
      const { result } = renderHook(() => useGrid(), {
        wrapper: GridWrapper,
      });

      await waitFor(
        () => {
          expect(result.current.grid).not.toBeNull();
        },
        { timeout: 3000 } // Increased timeout for CI environments with slower I/O
      );
    });

    it('should return getItems function that retrieves items', async () => {
      const { result } = renderHook(() => useGrid(), {
        wrapper: GridWrapper,
      });

      await waitFor(
        () => {
          expect(result.current.grid).not.toBeNull();
        },
        { timeout: 3000 } // Increased timeout for CI environments with slower I/O
      );

      const items = result.current.getItems();
      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBeGreaterThan(0);
    });

    it('should provide layout function that triggers recalculation', async () => {
      const { result } = renderHook(() => useGrid(), {
        wrapper: GridWrapper,
      });

      await waitFor(
        () => {
          expect(result.current.grid).not.toBeNull();
        },
        { timeout: 3000 } // Increased timeout for CI environments with slower I/O
      );

      // Should not throw
      expect(() => result.current.layout()).not.toThrow();
      expect(() => result.current.layout(true)).not.toThrow();
    });

    it('should provide filter function', async () => {
      const { result } = renderHook(() => useGrid(), {
        wrapper: GridWrapper,
      });

      await waitFor(
        () => {
          expect(result.current.grid).not.toBeNull();
        },
        { timeout: 3000 } // Increased timeout for CI environments with slower I/O
      );

      // Should not throw
      expect(() => result.current.filter(() => true)).not.toThrow();
    });

    it('should provide sort function', async () => {
      const { result } = renderHook(() => useGrid(), {
        wrapper: GridWrapper,
      });

      await waitFor(
        () => {
          expect(result.current.grid).not.toBeNull();
        },
        { timeout: 3000 } // Increased timeout for CI environments with slower I/O
      );

      // Should not throw
      expect(() => result.current.sort('data-id')).not.toThrow();
    });

    it('should provide refreshItems function', async () => {
      const { result } = renderHook(() => useGrid(), {
        wrapper: GridWrapper,
      });

      await waitFor(
        () => {
          expect(result.current.grid).not.toBeNull();
        },
        { timeout: 3000 } // Increased timeout for CI environments with slower I/O
      );

      // Should not throw
      expect(() => result.current.refreshItems()).not.toThrow();
    });

    it('should provide refreshSortData function', async () => {
      const { result } = renderHook(() => useGrid(), {
        wrapper: GridWrapper,
      });

      await waitFor(
        () => {
          expect(result.current.grid).not.toBeNull();
        },
        { timeout: 3000 } // Increased timeout for CI environments with slower I/O
      );

      // Should not throw
      expect(() => result.current.refreshSortData()).not.toThrow();
    });
  });

  describe('return type stability', () => {
    it('should return the same function references across renders', async () => {
      function GridWrapper({ children }: { children: ReactNode }) {
        return (
          <MuuriGrid>
            <MuuriItem key="1">
              <div style={{ width: 100, height: 100 }}>Item</div>
            </MuuriItem>
            {children}
          </MuuriGrid>
        );
      }

      const { result, rerender } = renderHook(() => useGrid(), {
        wrapper: GridWrapper,
      });

      await waitFor(
        () => {
          expect(result.current.grid).not.toBeNull();
        },
        { timeout: 3000 } // Increased timeout for CI environments with slower I/O
      );

      const firstLayout = result.current.layout;
      const firstFilter = result.current.filter;
      const firstSort = result.current.sort;

      rerender();

      // Functions should be stable (same reference)
      expect(result.current.layout).toBe(firstLayout);
      expect(result.current.filter).toBe(firstFilter);
      expect(result.current.sort).toBe(firstSort);
    });
  });
});

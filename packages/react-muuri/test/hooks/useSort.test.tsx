import { render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { MuuriGrid } from '../../src/MuuriGrid.js';
import { MuuriItem } from '../../src/MuuriItem.js';
import { useSort } from '../../src/hooks/useSort.js';

describe('useSort', () => {
  describe('outside MuuriGrid context', () => {
    it('should return a no-op sort function when used outside context', () => {
      const { result } = renderHook(() => useSort());

      expect(result.current.sort).toBeInstanceOf(Function);
    });

    it('should not throw when calling sort outside context', () => {
      const { result } = renderHook(() => useSort());

      expect(() => result.current.sort('data-id')).not.toThrow();
      expect(() => result.current.sort((_a, _b) => 0)).not.toThrow();
    });
  });

  describe('inside MuuriGrid context', () => {
    function GridWrapper({ children }: { children: ReactNode }) {
      return (
        <MuuriGrid>
          <MuuriItem key="1">
            <div
              data-testid="item1"
              data-order="3"
              data-name="Charlie"
              style={{ width: 100, height: 100 }}
            >
              Item 1
            </div>
          </MuuriItem>
          <MuuriItem key="2">
            <div
              data-testid="item2"
              data-order="1"
              data-name="Alpha"
              style={{ width: 100, height: 100 }}
            >
              Item 2
            </div>
          </MuuriItem>
          <MuuriItem key="3">
            <div
              data-testid="item3"
              data-order="2"
              data-name="Bravo"
              style={{ width: 100, height: 100 }}
            >
              Item 3
            </div>
          </MuuriItem>
          {children}
        </MuuriGrid>
      );
    }

    it('should return sort function that works inside MuuriGrid', async () => {
      const { result } = renderHook(() => useSort(), {
        wrapper: GridWrapper,
      });

      await waitFor(
        () => {
          expect(result.current.sort).toBeInstanceOf(Function);
        },
        { timeout: 1000 }
      );

      expect(() => result.current.sort('data-order')).not.toThrow();
    });

    it('should accept data attribute string', async () => {
      const { result } = renderHook(() => useSort(), {
        wrapper: GridWrapper,
      });

      await waitFor(
        () => {
          expect(result.current.sort).toBeInstanceOf(Function);
        },
        { timeout: 1000 }
      );

      // Sort by data-order attribute
      expect(() => result.current.sort('data-order')).not.toThrow();
    });

    it('should accept custom comparer for multi-attribute sorting', async () => {
      const { result } = renderHook(() => useSort(), {
        wrapper: GridWrapper,
      });

      await waitFor(
        () => {
          expect(result.current.sort).toBeInstanceOf(Function);
        },
        { timeout: 1000 }
      );

      // Sort by multiple attributes using custom comparer
      expect(() =>
        result.current.sort((itemA, itemB) => {
          const elA = itemA.getElement();
          const elB = itemB.getElement();
          if (!elA || !elB) return 0;
          const orderA = parseInt(elA.getAttribute('data-order') ?? '0', 10);
          const orderB = parseInt(elB.getAttribute('data-order') ?? '0', 10);
          if (orderA !== orderB) return orderA - orderB;
          const nameA = elA.getAttribute('data-name') ?? '';
          const nameB = elB.getAttribute('data-name') ?? '';
          return nameA.localeCompare(nameB);
        })
      ).not.toThrow();
    });

    it('should accept comparer function', async () => {
      const { result } = renderHook(() => useSort(), {
        wrapper: GridWrapper,
      });

      await waitFor(
        () => {
          expect(result.current.sort).toBeInstanceOf(Function);
        },
        { timeout: 1000 }
      );

      // Sort using custom comparer
      expect(() =>
        result.current.sort((itemA, itemB) => {
          const elA = itemA.getElement();
          const elB = itemB.getElement();
          if (!elA || !elB) return 0;
          const orderA = parseInt(
            elA.querySelector('[data-order]')?.getAttribute('data-order') ?? '0',
            10
          );
          const orderB = parseInt(
            elB.querySelector('[data-order]')?.getAttribute('data-order') ?? '0',
            10
          );
          return orderA - orderB;
        })
      ).not.toThrow();
    });

    it('should accept sort options', async () => {
      const { result } = renderHook(() => useSort(), {
        wrapper: GridWrapper,
      });

      await waitFor(
        () => {
          expect(result.current.sort).toBeInstanceOf(Function);
        },
        { timeout: 1000 }
      );

      // Sort with options
      expect(() =>
        result.current.sort('data-order', {
          descending: true,
          layout: false,
        })
      ).not.toThrow();
    });
  });

  describe('sort functionality', () => {
    function SortableGrid() {
      const { sort } = useSort();

      return (
        <div>
          <button data-testid="sort-asc-btn" type="button" onClick={() => sort('data-order')}>
            Sort Ascending
          </button>
          <button
            data-testid="sort-desc-btn"
            type="button"
            onClick={() => sort('data-order', { descending: true })}
          >
            Sort Descending
          </button>
          <button data-testid="sort-name-btn" type="button" onClick={() => sort('data-name')}>
            Sort by Name
          </button>
        </div>
      );
    }

    it('should render sort controls', async () => {
      render(
        <MuuriGrid>
          <MuuriItem key="1">
            <div data-order="3" data-name="C" style={{ width: 100, height: 100 }}>
              C
            </div>
          </MuuriItem>
          <MuuriItem key="2">
            <div data-order="1" data-name="A" style={{ width: 100, height: 100 }}>
              A
            </div>
          </MuuriItem>
          <MuuriItem key="3">
            <div data-order="2" data-name="B" style={{ width: 100, height: 100 }}>
              B
            </div>
          </MuuriItem>
          <SortableGrid />
        </MuuriGrid>
      );

      await waitFor(
        () => {
          expect(screen.getByTestId('sort-asc-btn')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );

      // Should be able to click sort buttons
      expect(() => screen.getByTestId('sort-asc-btn').click()).not.toThrow();
      expect(() => screen.getByTestId('sort-desc-btn').click()).not.toThrow();
      expect(() => screen.getByTestId('sort-name-btn').click()).not.toThrow();
    });
  });

  describe('return type structure', () => {
    it('should return object with sort function', () => {
      const { result } = renderHook(() => useSort());

      expect(result.current).toHaveProperty('sort');
      expect(typeof result.current.sort).toBe('function');
    });
  });

  describe('function stability', () => {
    it('should maintain consistent function behavior across renders', async () => {
      function GridWrapper({ children }: { children: ReactNode }) {
        return (
          <MuuriGrid>
            <MuuriItem key="1">
              <div data-order="1" style={{ width: 100, height: 100 }}>
                Item
              </div>
            </MuuriItem>
            {children}
          </MuuriGrid>
        );
      }

      const { result, rerender } = renderHook(() => useSort(), {
        wrapper: GridWrapper,
      });

      await waitFor(() => {
        expect(result.current.sort).toBeInstanceOf(Function);
      });

      expect(() => result.current.sort('data-order')).not.toThrow();

      rerender();

      expect(() => result.current.sort('data-order')).not.toThrow();
      expect(result.current.sort).toBeInstanceOf(Function);
    });
  });
});

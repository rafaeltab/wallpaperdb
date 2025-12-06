import { render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { MuuriGrid } from '../../src/MuuriGrid.js';
import { MuuriItem } from '../../src/MuuriItem.js';
import { useFilter } from '../../src/hooks/useFilter.js';
import { useGrid } from '../../src/hooks/useGrid.js';

describe('useFilter', () => {
  describe('outside MuuriGrid context', () => {
    it('should return a no-op filter function when used outside context', () => {
      const { result } = renderHook(() => useFilter());

      expect(result.current.filter).toBeInstanceOf(Function);
    });

    it('should not throw when calling filter outside context', () => {
      const { result } = renderHook(() => useFilter());

      expect(() => result.current.filter(() => true)).not.toThrow();
      expect(() => result.current.filter('.visible')).not.toThrow();
    });
  });

  describe('inside MuuriGrid context', () => {
    function GridWrapper({ children }: { children: ReactNode }) {
      return (
        <MuuriGrid>
          <MuuriItem key="1" itemKey="item1">
            <div data-testid="item1" data-visible="true" style={{ width: 100, height: 100 }}>
              Item 1
            </div>
          </MuuriItem>
          <MuuriItem key="2" itemKey="item2">
            <div data-testid="item2" data-visible="false" style={{ width: 100, height: 100 }}>
              Item 2
            </div>
          </MuuriItem>
          <MuuriItem key="3" itemKey="item3">
            <div data-testid="item3" data-visible="true" style={{ width: 100, height: 100 }}>
              Item 3
            </div>
          </MuuriItem>
          {children}
        </MuuriGrid>
      );
    }

    it('should return filter function that works inside MuuriGrid', async () => {
      const { result } = renderHook(() => useFilter(), {
        wrapper: GridWrapper,
      });

      await waitFor(
        () => {
          expect(result.current.filter).toBeInstanceOf(Function);
        },
        { timeout: 1000 }
      );

      // Should not throw
      expect(() => result.current.filter(() => true)).not.toThrow();
    });

    it('should accept predicate function', async () => {
      const { result } = renderHook(() => useFilter(), {
        wrapper: GridWrapper,
      });

      await waitFor(
        () => {
          expect(result.current.filter).toBeInstanceOf(Function);
        },
        { timeout: 1000 }
      );

      // Filter to show only items with data-visible="true"
      expect(() =>
        result.current.filter((item) => {
          const el = item.getElement();
          const content = el.querySelector('[data-visible]');
          return content?.getAttribute('data-visible') === 'true';
        })
      ).not.toThrow();
    });

    it('should accept CSS selector string', async () => {
      const { result } = renderHook(() => useFilter(), {
        wrapper: GridWrapper,
      });

      await waitFor(
        () => {
          expect(result.current.filter).toBeInstanceOf(Function);
        },
        { timeout: 1000 }
      );

      // Filter using CSS selector
      expect(() => result.current.filter('[data-visible="true"]')).not.toThrow();
    });

    it('should accept filter options', async () => {
      const { result } = renderHook(() => useFilter(), {
        wrapper: GridWrapper,
      });

      await waitFor(
        () => {
          expect(result.current.filter).toBeInstanceOf(Function);
        },
        { timeout: 1000 }
      );

      // Filter with options
      expect(() =>
        result.current.filter(() => true, {
          instant: true,
          layout: false,
        })
      ).not.toThrow();
    });
  });

  describe('filter functionality', () => {
    function FilterableGrid() {
      const { filter } = useFilter();
      const { getItems } = useGrid();

      return (
        <div>
          <button
            data-testid="filter-btn"
            type="button"
            onClick={() =>
              filter((item) => {
                const el = item.getElement();
                return el.querySelector('[data-category="a"]') !== null;
              })
            }
          >
            Filter A
          </button>
          <button data-testid="show-all-btn" type="button" onClick={() => filter(() => true)}>
            Show All
          </button>
          <button
            data-testid="count-btn"
            type="button"
            onClick={() =>
              console.log('Visible items:', getItems().filter((i) => i.isVisible()).length)
            }
          >
            Count
          </button>
        </div>
      );
    }

    it('should render filter controls', async () => {
      render(
        <MuuriGrid>
          <MuuriItem key="1">
            <div data-category="a" style={{ width: 100, height: 100 }}>
              A1
            </div>
          </MuuriItem>
          <MuuriItem key="2">
            <div data-category="b" style={{ width: 100, height: 100 }}>
              B1
            </div>
          </MuuriItem>
          <FilterableGrid />
        </MuuriGrid>
      );

      await waitFor(
        () => {
          expect(screen.getByTestId('filter-btn')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );

      // Should be able to click filter buttons
      expect(() => screen.getByTestId('filter-btn').click()).not.toThrow();
      expect(() => screen.getByTestId('show-all-btn').click()).not.toThrow();
    });
  });

  describe('return type structure', () => {
    it('should return object with filter function', () => {
      const { result } = renderHook(() => useFilter());

      expect(result.current).toHaveProperty('filter');
      expect(typeof result.current.filter).toBe('function');
    });
  });

  describe('function stability', () => {
    it('should maintain consistent function behavior across renders', async () => {
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

      const { result, rerender } = renderHook(() => useFilter(), {
        wrapper: GridWrapper,
      });

      await waitFor(() => {
        expect(result.current.filter).toBeInstanceOf(Function);
      });

      expect(() => result.current.filter(() => true)).not.toThrow();

      rerender();

      expect(() => result.current.filter(() => true)).not.toThrow();
      expect(result.current.filter).toBeInstanceOf(Function);
    });
  });
});

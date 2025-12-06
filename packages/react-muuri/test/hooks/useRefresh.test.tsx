import { render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { MuuriGrid } from '../../src/MuuriGrid.js';
import { MuuriItem } from '../../src/MuuriItem.js';
import { useRefresh } from '../../src/hooks/useRefresh.js';

describe('useRefresh', () => {
  describe('outside context', () => {
    it('should return a no-op refresh function when used outside MuuriItem', () => {
      const { result } = renderHook(() => useRefresh());

      expect(result.current.refresh).toBeInstanceOf(Function);
    });

    it('should not throw when calling refresh outside context', () => {
      const { result } = renderHook(() => useRefresh());

      expect(() => result.current.refresh()).not.toThrow();
      expect(() => result.current.refresh(true)).not.toThrow();
    });
  });

  describe('inside MuuriItem context', () => {
    function ItemWithRefresh({ testId }: { testId: string }) {
      const { refresh } = useRefresh();
      const [refreshed, setRefreshed] = useState(false);

      return (
        <button
          type="button"
          data-testid={testId}
          style={{ width: 100, height: 100 }}
          onClick={() => {
            refresh();
            setRefreshed(true);
          }}
        >
          <span data-testid={`${testId}-refreshed`}>{refreshed ? 'yes' : 'no'}</span>
        </button>
      );
    }

    it('should return refresh function that works inside MuuriItem', async () => {
      render(
        <MuuriGrid>
          <MuuriItem key="1">
            <ItemWithRefresh testId="item1" />
          </MuuriItem>
        </MuuriGrid>
      );

      // Wait for grid to initialize
      await waitFor(
        () => {
          expect(screen.getByTestId('item1')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );

      // Clicking should call refresh without error
      screen.getByTestId('item1').click();

      await waitFor(() => {
        expect(screen.getByTestId('item1-refreshed')).toHaveTextContent('yes');
      });
    });

    it('should accept force parameter', async () => {
      function ItemWithForceRefresh() {
        const { refresh } = useRefresh();
        return (
          <button
            type="button"
            data-testid="item"
            style={{ width: 100, height: 100 }}
            onClick={() => refresh(true)}
          >
            Content
          </button>
        );
      }

      render(
        <MuuriGrid>
          <MuuriItem key="1">
            <ItemWithForceRefresh />
          </MuuriItem>
        </MuuriGrid>
      );

      await waitFor(
        () => {
          expect(screen.getByTestId('item')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );

      // Should not throw with force parameter
      expect(() => screen.getByTestId('item').click()).not.toThrow();
    });
  });

  describe('return type stability', () => {
    it('should maintain consistent function behavior across renders', async () => {
      function GridWrapper({ children }: { children: ReactNode }) {
        return (
          <MuuriGrid>
            <MuuriItem key="1">
              <div style={{ width: 100, height: 100 }}>{children}</div>
            </MuuriItem>
          </MuuriGrid>
        );
      }

      const { result, rerender } = renderHook(() => useRefresh(), {
        wrapper: GridWrapper,
      });

      await waitFor(() => {
        expect(result.current.refresh).toBeInstanceOf(Function);
      });

      // First call should work
      expect(() => result.current.refresh()).not.toThrow();

      rerender();

      // After rerender, function should still work
      expect(() => result.current.refresh()).not.toThrow();
      expect(result.current.refresh).toBeInstanceOf(Function);
    });
  });

  describe('return type structure', () => {
    it('should return object with refresh function', () => {
      const { result } = renderHook(() => useRefresh());

      expect(result.current).toHaveProperty('refresh');
      expect(typeof result.current.refresh).toBe('function');
    });
  });
});

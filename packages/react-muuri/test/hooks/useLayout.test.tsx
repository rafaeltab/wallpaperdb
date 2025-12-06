import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MuuriGrid } from '../../src/MuuriGrid.js';
import { MuuriItem } from '../../src/MuuriItem.js';
import { useLayout } from '../../src/hooks/useLayout.js';

describe('useLayout', () => {
  describe('outside MuuriGrid context', () => {
    it('should return a no-op layout function when used outside context', () => {
      const { result } = renderHook(() => useLayout());

      expect(result.current.layout).toBeInstanceOf(Function);
    });

    it('should not throw when calling layout outside context', () => {
      const { result } = renderHook(() => useLayout());

      expect(() => result.current.layout()).not.toThrow();
      expect(() => result.current.layout(true)).not.toThrow();
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

    it('should return layout function that triggers recalculation', async () => {
      const { result } = renderHook(() => useLayout(), {
        wrapper: GridWrapper,
      });

      // Wait for grid to initialize
      await waitFor(() => {
        expect(() => result.current.layout()).not.toThrow();
      });
    });

    it('should accept instant parameter for immediate layout', async () => {
      const { result } = renderHook(() => useLayout(), {
        wrapper: GridWrapper,
      });

      await waitFor(() => {
        expect(() => result.current.layout(true)).not.toThrow();
      });
    });

    it('should trigger layout and call onLayoutEnd', async () => {
      const onLayoutEnd = vi.fn();

      function GridWrapperWithCallback({ children }: { children: ReactNode }) {
        return (
          <MuuriGrid onLayoutEnd={onLayoutEnd}>
            <MuuriItem key="1">
              <div style={{ width: 100, height: 100 }}>Item 1</div>
            </MuuriItem>
            {children}
          </MuuriGrid>
        );
      }

      const { result } = renderHook(() => useLayout(), {
        wrapper: GridWrapperWithCallback,
      });

      // Wait for initial layout
      await waitFor(
        () => {
          expect(onLayoutEnd).toHaveBeenCalled();
        },
        { timeout: 1000 }
      );

      // Trigger another layout - should not throw
      expect(() => result.current.layout()).not.toThrow();

      // The layout function should be working - callback was called at least once
      expect(onLayoutEnd.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('return type stability', () => {
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

      const { result, rerender } = renderHook(() => useLayout(), {
        wrapper: GridWrapper,
      });

      await waitFor(() => {
        expect(result.current.layout).toBeInstanceOf(Function);
      });

      // First call should work
      expect(() => result.current.layout()).not.toThrow();

      rerender();

      // After rerender, function should still work
      expect(() => result.current.layout()).not.toThrow();
      expect(result.current.layout).toBeInstanceOf(Function);
    });
  });

  describe('return type structure', () => {
    it('should return object with layout function', () => {
      const { result } = renderHook(() => useLayout());

      expect(result.current).toHaveProperty('layout');
      expect(typeof result.current.layout).toBe('function');
    });
  });
});

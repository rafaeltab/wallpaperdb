import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MuuriGrid } from '../../src/MuuriGrid.js';
import { MuuriItem } from '../../src/MuuriItem.js';
import { useItem } from '../../src/hooks/useItem.js';

describe('useItem', () => {
  describe('outside ItemContext', () => {
    it('should return null item when used outside MuuriItem', () => {
      const { result } = renderHook(() => useItem());

      expect(result.current.item).toBeNull();
    });

    it('should return false for all state flags when outside context', () => {
      const { result } = renderHook(() => useItem());

      expect(result.current.isDragging).toBe(false);
      expect(result.current.isPositioning).toBe(false);
      expect(result.current.isVisible).toBe(false);
      expect(result.current.isShowing).toBe(false);
      expect(result.current.isHiding).toBe(false);
      expect(result.current.isReleasing).toBe(false);
    });
  });

  describe('inside MuuriItem context', () => {
    function ItemComponent({ testId }: { testId: string }) {
      const itemState = useItem();
      return (
        <div data-testid={testId}>
          <span data-testid={`${testId}-has-item`}>{itemState.item ? 'yes' : 'no'}</span>
          <span data-testid={`${testId}-visible`}>{itemState.isVisible ? 'yes' : 'no'}</span>
          <span data-testid={`${testId}-dragging`}>{itemState.isDragging ? 'yes' : 'no'}</span>
        </div>
      );
    }

    it('should return item instance when inside MuuriItem', async () => {
      render(
        <MuuriGrid>
          <MuuriItem key="1">
            <ItemComponent testId="item1" />
          </MuuriItem>
        </MuuriGrid>
      );

      await waitFor(
        () => {
          expect(screen.getByTestId('item1-has-item')).toHaveTextContent('yes');
        },
        { timeout: 1000 }
      );
    });

    it('should initially show isVisible as true for visible items', async () => {
      render(
        <MuuriGrid>
          <MuuriItem key="1">
            <ItemComponent testId="item1" />
          </MuuriItem>
        </MuuriGrid>
      );

      await waitFor(
        () => {
          expect(screen.getByTestId('item1-has-item')).toHaveTextContent('yes');
        },
        { timeout: 1000 }
      );

      // Items are visible by default
      expect(screen.getByTestId('item1-visible')).toHaveTextContent('yes');
    });

    it('should return isDragging as false initially', async () => {
      render(
        <MuuriGrid dragEnabled>
          <MuuriItem key="1">
            <ItemComponent testId="item1" />
          </MuuriItem>
        </MuuriGrid>
      );

      await waitFor(
        () => {
          expect(screen.getByTestId('item1-has-item')).toHaveTextContent('yes');
        },
        { timeout: 1000 }
      );

      expect(screen.getByTestId('item1-dragging')).toHaveTextContent('no');
    });
  });

  describe('multiple items', () => {
    function ItemComponent({ testId }: { testId: string }) {
      const itemState = useItem();
      return (
        <div data-testid={testId} style={{ width: 100, height: 100 }}>
          <span data-testid={`${testId}-has-item`}>{itemState.item ? 'yes' : 'no'}</span>
        </div>
      );
    }

    it('should provide separate item instances for each MuuriItem', async () => {
      render(
        <MuuriGrid>
          <MuuriItem key="1">
            <ItemComponent testId="item1" />
          </MuuriItem>
          <MuuriItem key="2">
            <ItemComponent testId="item2" />
          </MuuriItem>
        </MuuriGrid>
      );

      await waitFor(
        () => {
          expect(screen.getByTestId('item1-has-item')).toHaveTextContent('yes');
          expect(screen.getByTestId('item2-has-item')).toHaveTextContent('yes');
        },
        { timeout: 1000 }
      );
    });
  });

  describe('return type structure', () => {
    it('should return all expected properties', () => {
      const { result } = renderHook(() => useItem());

      expect(result.current).toHaveProperty('item');
      expect(result.current).toHaveProperty('isDragging');
      expect(result.current).toHaveProperty('isPositioning');
      expect(result.current).toHaveProperty('isVisible');
      expect(result.current).toHaveProperty('isShowing');
      expect(result.current).toHaveProperty('isHiding');
      expect(result.current).toHaveProperty('isReleasing');
    });
  });
});

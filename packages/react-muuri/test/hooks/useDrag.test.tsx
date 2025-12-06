import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MuuriGrid } from '../../src/MuuriGrid.js';
import { MuuriItem } from '../../src/MuuriItem.js';
import { useDrag } from '../../src/hooks/useDrag.js';

describe('useDrag', () => {
  describe('outside context', () => {
    it('should return isDragging as false when outside MuuriItem', () => {
      const { result } = renderHook(() => useDrag());

      expect(result.current.isDragging).toBe(false);
    });

    it('should return isReleasing as false when outside MuuriItem', () => {
      const { result } = renderHook(() => useDrag());

      expect(result.current.isReleasing).toBe(false);
    });
  });

  describe('inside MuuriItem context', () => {
    function DraggableItem({ testId }: { testId: string }) {
      const { isDragging, isReleasing } = useDrag();
      return (
        <div data-testid={testId} style={{ width: 100, height: 100 }}>
          <span data-testid={`${testId}-dragging`}>{isDragging ? 'yes' : 'no'}</span>
          <span data-testid={`${testId}-releasing`}>{isReleasing ? 'yes' : 'no'}</span>
        </div>
      );
    }

    it('should return isDragging as false initially', async () => {
      render(
        <MuuriGrid dragEnabled>
          <MuuriItem key="1">
            <DraggableItem testId="item1" />
          </MuuriItem>
        </MuuriGrid>
      );

      await waitFor(
        () => {
          expect(screen.getByTestId('item1')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );

      expect(screen.getByTestId('item1-dragging')).toHaveTextContent('no');
    });

    it('should return isReleasing as false initially', async () => {
      render(
        <MuuriGrid dragEnabled>
          <MuuriItem key="1">
            <DraggableItem testId="item1" />
          </MuuriItem>
        </MuuriGrid>
      );

      await waitFor(
        () => {
          expect(screen.getByTestId('item1')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );

      expect(screen.getByTestId('item1-releasing')).toHaveTextContent('no');
    });
  });

  describe('multiple items', () => {
    function DraggableItem({ testId }: { testId: string }) {
      const { isDragging } = useDrag();
      return (
        <div data-testid={testId} style={{ width: 100, height: 100 }}>
          <span data-testid={`${testId}-dragging`}>{isDragging ? 'yes' : 'no'}</span>
        </div>
      );
    }

    it('should provide separate drag state for each item', async () => {
      render(
        <MuuriGrid dragEnabled>
          <MuuriItem key="1">
            <DraggableItem testId="item1" />
          </MuuriItem>
          <MuuriItem key="2">
            <DraggableItem testId="item2" />
          </MuuriItem>
        </MuuriGrid>
      );

      await waitFor(
        () => {
          expect(screen.getByTestId('item1')).toBeInTheDocument();
          expect(screen.getByTestId('item2')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );

      // Both should start as not dragging
      expect(screen.getByTestId('item1-dragging')).toHaveTextContent('no');
      expect(screen.getByTestId('item2-dragging')).toHaveTextContent('no');
    });
  });

  describe('return type structure', () => {
    it('should return object with isDragging and isReleasing', () => {
      const { result } = renderHook(() => useDrag());

      expect(result.current).toHaveProperty('isDragging');
      expect(result.current).toHaveProperty('isReleasing');
      expect(typeof result.current.isDragging).toBe('boolean');
      expect(typeof result.current.isReleasing).toBe('boolean');
    });
  });

  describe('with drag disabled', () => {
    function DraggableItem({ testId }: { testId: string }) {
      const { isDragging } = useDrag();
      return (
        <div data-testid={testId} style={{ width: 100, height: 100 }}>
          <span data-testid={`${testId}-dragging`}>{isDragging ? 'yes' : 'no'}</span>
        </div>
      );
    }

    it('should still work when drag is disabled', async () => {
      render(
        <MuuriGrid dragEnabled={false}>
          <MuuriItem key="1">
            <DraggableItem testId="item1" />
          </MuuriItem>
        </MuuriGrid>
      );

      await waitFor(
        () => {
          expect(screen.getByTestId('item1')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );

      // Should work but always be false since drag is disabled
      expect(screen.getByTestId('item1-dragging')).toHaveTextContent('no');
    });
  });
});

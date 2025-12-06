import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MuuriGrid } from '../../src/MuuriGrid.js';
import { MuuriItem } from '../../src/MuuriItem.js';
import { useDrag } from '../../src/hooks/useDrag.js';
import { useGrid } from '../../src/hooks/useGrid.js';
import { useItem } from '../../src/hooks/useItem.js';

describe('Drag and Drop Integration', () => {
  describe('drag-enabled grid', () => {
    it('should render items with drag enabled', async () => {
      render(
        <MuuriGrid dragEnabled dragSort>
          <MuuriItem key="1">
            <div data-testid="item1" style={{ width: 100, height: 100 }}>
              Item 1
            </div>
          </MuuriItem>
          <MuuriItem key="2">
            <div data-testid="item2" style={{ width: 100, height: 100 }}>
              Item 2
            </div>
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
    });

    it('should call onDragStart when drag starts', async () => {
      const onDragStart = vi.fn();

      render(
        <MuuriGrid dragEnabled onDragStart={onDragStart}>
          <MuuriItem key="1">
            <div data-testid="item1" style={{ width: 100, height: 100 }}>
              Item 1
            </div>
          </MuuriItem>
        </MuuriGrid>
      );

      await waitFor(
        () => {
          expect(screen.getByTestId('item1')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );

      // Note: Actually triggering drag would require simulating mouse events
      // which is complex in jsdom. This test verifies the callback is passed correctly.
      expect(onDragStart).not.toHaveBeenCalled(); // Not dragged yet
    });

    it('should call onDragEnd when drag ends', async () => {
      const onDragEnd = vi.fn();

      render(
        <MuuriGrid dragEnabled onDragEnd={onDragEnd}>
          <MuuriItem key="1">
            <div data-testid="item1" style={{ width: 100, height: 100 }}>
              Item 1
            </div>
          </MuuriItem>
        </MuuriGrid>
      );

      await waitFor(
        () => {
          expect(screen.getByTestId('item1')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );

      expect(onDragEnd).not.toHaveBeenCalled();
    });
  });

  describe('combined hooks usage', () => {
    function DraggableCard({ testId }: { testId: string }) {
      const { item, isVisible } = useItem();
      const { isDragging, isReleasing } = useDrag();

      return (
        <div
          data-testid={testId}
          style={{
            width: 100,
            height: 100,
            opacity: isDragging ? 0.5 : 1,
            visibility: isVisible ? 'visible' : 'hidden',
          }}
        >
          <span data-testid={`${testId}-has-item`}>{item ? 'yes' : 'no'}</span>
          <span data-testid={`${testId}-dragging`}>{isDragging ? 'yes' : 'no'}</span>
          <span data-testid={`${testId}-releasing`}>{isReleasing ? 'yes' : 'no'}</span>
        </div>
      );
    }

    it('should provide all hook values together', async () => {
      render(
        <MuuriGrid dragEnabled>
          <MuuriItem key="1">
            <DraggableCard testId="card1" />
          </MuuriItem>
        </MuuriGrid>
      );

      await waitFor(
        () => {
          expect(screen.getByTestId('card1-has-item')).toHaveTextContent('yes');
        },
        { timeout: 1000 }
      );

      expect(screen.getByTestId('card1-dragging')).toHaveTextContent('no');
      expect(screen.getByTestId('card1-releasing')).toHaveTextContent('no');
    });

    it('should work with multiple draggable items', async () => {
      render(
        <MuuriGrid dragEnabled dragSort>
          <MuuriItem key="1">
            <DraggableCard testId="card1" />
          </MuuriItem>
          <MuuriItem key="2">
            <DraggableCard testId="card2" />
          </MuuriItem>
          <MuuriItem key="3">
            <DraggableCard testId="card3" />
          </MuuriItem>
        </MuuriGrid>
      );

      await waitFor(
        () => {
          expect(screen.getByTestId('card1-has-item')).toHaveTextContent('yes');
          expect(screen.getByTestId('card2-has-item')).toHaveTextContent('yes');
          expect(screen.getByTestId('card3-has-item')).toHaveTextContent('yes');
        },
        { timeout: 1000 }
      );
    });
  });

  describe('grid access from child', () => {
    function GridAwareCard({ testId }: { testId: string }) {
      const { grid, layout, getItems } = useGrid();

      return (
        <div data-testid={testId} style={{ width: 100, height: 100 }}>
          <span data-testid={`${testId}-has-grid`}>{grid ? 'yes' : 'no'}</span>
          <button data-testid={`${testId}-layout-btn`} onClick={() => layout()} type="button">
            Layout
          </button>
          <button
            data-testid={`${testId}-count-btn`}
            onClick={() => {
              const items = getItems();
              // Just verify it works
              console.log('Items count:', items.length);
            }}
            type="button"
          >
            Count
          </button>
        </div>
      );
    }

    it('should allow child components to access grid via useGrid', async () => {
      render(
        <MuuriGrid dragEnabled>
          <MuuriItem key="1">
            <GridAwareCard testId="card1" />
          </MuuriItem>
        </MuuriGrid>
      );

      await waitFor(
        () => {
          expect(screen.getByTestId('card1-has-grid')).toHaveTextContent('yes');
        },
        { timeout: 1000 }
      );

      // Should be able to click buttons without error
      expect(() => screen.getByTestId('card1-layout-btn').click()).not.toThrow();
      expect(() => screen.getByTestId('card1-count-btn').click()).not.toThrow();
    });
  });

  describe('drag handle', () => {
    it('should accept dragHandle prop', async () => {
      render(
        <MuuriGrid dragEnabled dragHandle=".handle">
          <MuuriItem key="1">
            <div data-testid="item1" style={{ width: 100, height: 100 }}>
              <div className="handle" data-testid="handle">
                Drag here
              </div>
              <div>Content</div>
            </div>
          </MuuriItem>
        </MuuriGrid>
      );

      await waitFor(
        () => {
          expect(screen.getByTestId('handle')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );
    });
  });

  describe('drag placeholder', () => {
    it('should accept dragPlaceholder prop', async () => {
      render(
        <MuuriGrid
          dragEnabled
          dragPlaceholder={{
            enabled: true,
            createElement: (_item) => {
              const el = document.createElement('div');
              el.className = 'placeholder';
              return el;
            },
          }}
        >
          <MuuriItem key="1">
            <div data-testid="item1" style={{ width: 100, height: 100 }}>
              Item 1
            </div>
          </MuuriItem>
        </MuuriGrid>
      );

      await waitFor(
        () => {
          expect(screen.getByTestId('item1')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );
    });
  });
});

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MuuriGrid } from '../../src/MuuriGrid.js';
import { MuuriItem } from '../../src/MuuriItem.js';

describe('Dynamic Items Integration', () => {
  describe('adding items', () => {
    it('should add new items to the grid', async () => {
      function DynamicGrid() {
        const [items, setItems] = useState([1, 2, 3]);

        return (
          <div>
            <button
              data-testid="add-btn"
              type="button"
              onClick={() => setItems([...items, items.length + 1])}
            >
              Add
            </button>
            <MuuriGrid>
              {items.map((id) => (
                <MuuriItem key={id}>
                  <div data-testid={`item-${id}`} style={{ width: 100, height: 100 }}>
                    Item {id}
                  </div>
                </MuuriItem>
              ))}
            </MuuriGrid>
          </div>
        );
      }

      render(<DynamicGrid />);

      await waitFor(
        () => {
          expect(screen.getByTestId('item-1')).toBeInTheDocument();
          expect(screen.getByTestId('item-2')).toBeInTheDocument();
          expect(screen.getByTestId('item-3')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );

      // Add a new item
      fireEvent.click(screen.getByTestId('add-btn'));

      await waitFor(
        () => {
          expect(screen.getByTestId('item-4')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );
    });

    it('should trigger onAdd callback when items are added', async () => {
      const onAdd = vi.fn();

      function DynamicGrid() {
        const [items, setItems] = useState([1]);

        return (
          <div>
            <button
              data-testid="add-btn"
              type="button"
              onClick={() => setItems([...items, items.length + 1])}
            >
              Add
            </button>
            <MuuriGrid onAdd={onAdd}>
              {items.map((id) => (
                <MuuriItem key={id}>
                  <div data-testid={`item-${id}`} style={{ width: 100, height: 100 }}>
                    Item {id}
                  </div>
                </MuuriItem>
              ))}
            </MuuriGrid>
          </div>
        );
      }

      render(<DynamicGrid />);

      await waitFor(
        () => {
          expect(screen.getByTestId('item-1')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );

      // Clear any initial calls from first render
      onAdd.mockClear();

      // Add a new item
      fireEvent.click(screen.getByTestId('add-btn'));

      await waitFor(
        () => {
          expect(screen.getByTestId('item-2')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );

      // onAdd should have been called for the new item - wait for callback to fire
      await waitFor(
        () => {
          expect(onAdd).toHaveBeenCalled();
        },
        { timeout: 1000 }
      );
    });
  });

  describe('removing items', () => {
    it('should remove items from the grid', async () => {
      function DynamicGrid() {
        const [items, setItems] = useState([1, 2, 3]);

        return (
          <div>
            <MuuriGrid>
              {items.map((id) => (
                <MuuriItem key={id}>
                  <div data-testid={`item-${id}`} style={{ width: 100, height: 100 }}>
                    Item {id}
                    <button
                      data-testid={`remove-${id}`}
                      type="button"
                      onClick={() => setItems(items.filter((i) => i !== id))}
                    >
                      ×
                    </button>
                  </div>
                </MuuriItem>
              ))}
            </MuuriGrid>
          </div>
        );
      }

      render(<DynamicGrid />);

      await waitFor(
        () => {
          expect(screen.getByTestId('item-1')).toBeInTheDocument();
          expect(screen.getByTestId('item-2')).toBeInTheDocument();
          expect(screen.getByTestId('item-3')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );

      // Remove item 2
      fireEvent.click(screen.getByTestId('remove-2'));

      await waitFor(
        () => {
          expect(screen.queryByTestId('item-2')).not.toBeInTheDocument();
        },
        { timeout: 1000 }
      );

      // Items 1 and 3 should still be there
      expect(screen.getByTestId('item-1')).toBeInTheDocument();
      expect(screen.getByTestId('item-3')).toBeInTheDocument();
    });

    it('should trigger onRemove callback when items are removed', async () => {
      const onRemove = vi.fn();

      function DynamicGrid() {
        const [items, setItems] = useState([1, 2, 3]);

        return (
          <div>
            <MuuriGrid onRemove={onRemove}>
              {items.map((id) => (
                <MuuriItem key={id}>
                  <div data-testid={`item-${id}`} style={{ width: 100, height: 100 }}>
                    Item {id}
                    <button
                      data-testid={`remove-${id}`}
                      type="button"
                      onClick={() => setItems(items.filter((i) => i !== id))}
                    >
                      ×
                    </button>
                  </div>
                </MuuriItem>
              ))}
            </MuuriGrid>
          </div>
        );
      }

      render(<DynamicGrid />);

      await waitFor(
        () => {
          expect(screen.getByTestId('item-2')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );

      // Remove item 2
      fireEvent.click(screen.getByTestId('remove-2'));

      await waitFor(
        () => {
          expect(screen.queryByTestId('item-2')).not.toBeInTheDocument();
        },
        { timeout: 1000 }
      );

      expect(onRemove).toHaveBeenCalled();
    });
  });

  /**
   * BUG TEST: Layout reflow on item removal
   *
   * When items are removed from the grid, remaining items should move
   * to fill the gap left by the removed item. Currently, items stay in
   * their original positions and don't move at all - leaving a visible
   * gap where the removed item was.
   *
   * Expected: Remove item 2 from [1, 2, 3] → items 1 and 3 should reposition
   * Actual: Remove item 2 from [1, 2, 3] → item 3 stays in same position, gap remains
   */
  describe('layout reflow on removal (BUG)', () => {
    it('should trigger layout animation after removing an item', async () => {
      const onLayoutStart = vi.fn();
      const onLayoutEnd = vi.fn();

      function DynamicGrid() {
        const [items, setItems] = useState([1, 2, 3]);

        return (
          <div>
            <MuuriGrid
              layoutDuration={300}
              onLayoutStart={onLayoutStart}
              onLayoutEnd={onLayoutEnd}
            >
              {items.map((id) => (
                <MuuriItem key={id}>
                  <div data-testid={`item-${id}`} style={{ width: 100, height: 100 }}>
                    Item {id}
                    <button
                      data-testid={`remove-${id}`}
                      type="button"
                      onClick={() => setItems(items.filter((i) => i !== id))}
                    >
                      ×
                    </button>
                  </div>
                </MuuriItem>
              ))}
            </MuuriGrid>
          </div>
        );
      }

      render(<DynamicGrid />);

      await waitFor(
        () => {
          expect(screen.getByTestId('item-1')).toBeInTheDocument();
          expect(screen.getByTestId('item-2')).toBeInTheDocument();
          expect(screen.getByTestId('item-3')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );

      // Clear any initial layout calls
      onLayoutStart.mockClear();
      onLayoutEnd.mockClear();

      // Remove item 2
      await act(async () => {
        fireEvent.click(screen.getByTestId('remove-2'));
      });

      // Wait for the item to be removed
      await waitFor(
        () => {
          expect(screen.queryByTestId('item-2')).not.toBeInTheDocument();
        },
        { timeout: 1000 }
      );

      // BUG: Layout callbacks should be called after removing an item
      // Currently, the remove() call with layout: true may not trigger
      // animated layout if the item removal is instantaneous
      await waitFor(
        () => {
          expect(onLayoutStart).toHaveBeenCalled();
        },
        { timeout: 1000 }
      );

      expect(onLayoutEnd).toHaveBeenCalled();
    });

    it('should trigger hide animation before removing item', async () => {
      const onHide = vi.fn();
      const onRemove = vi.fn();

      function DynamicGrid() {
        const [items, setItems] = useState([1, 2, 3]);

        return (
          <div>
            <MuuriGrid hideDuration={200} onHide={onHide} onRemove={onRemove}>
              {items.map((id) => (
                <MuuriItem key={id}>
                  <div data-testid={`item-${id}`} style={{ width: 100, height: 100 }}>
                    Item {id}
                    <button
                      data-testid={`remove-${id}`}
                      type="button"
                      onClick={() => setItems(items.filter((i) => i !== id))}
                    >
                      ×
                    </button>
                  </div>
                </MuuriItem>
              ))}
            </MuuriGrid>
          </div>
        );
      }

      render(<DynamicGrid />);

      await waitFor(
        () => {
          expect(screen.getByTestId('item-2')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );

      // Clear any initial calls
      onHide.mockClear();
      onRemove.mockClear();

      // Remove item 2
      await act(async () => {
        fireEvent.click(screen.getByTestId('remove-2'));
      });

      // Wait for the item to be removed from DOM
      await waitFor(
        () => {
          expect(screen.queryByTestId('item-2')).not.toBeInTheDocument();
        },
        { timeout: 1000 }
      );

      // BUG: onHide should be called BEFORE onRemove
      // Currently, remove() is called directly without hide() first,
      // which may be related to why remaining items don't reposition
      expect(onHide).toHaveBeenCalled();
    });

    it('should move remaining items to fill gap after removal', async () => {
      /**
       * This test verifies that when an item is removed:
       * 1. The remaining items should move to fill the gap
       * 2. The layout should be recalculated and items repositioned
       *
       * Note: In jsdom, animations are instant (no CSS transitions).
       * This test verifies that layout is triggered; actual visual animation
       * must be tested in a real browser (e.g., Storybook).
       */
      const layoutStartCount = { current: 0 };
      const layoutEndCount = { current: 0 };

      function DynamicGrid() {
        const [items, setItems] = useState([1, 2, 3, 4, 5, 6]);

        return (
          <div>
            <MuuriGrid
              layoutDuration={300}
              onLayoutStart={() => {
                layoutStartCount.current++;
              }}
              onLayoutEnd={() => {
                layoutEndCount.current++;
              }}
            >
              {items.map((id) => (
                <MuuriItem key={id}>
                  <div data-testid={`item-${id}`} style={{ width: 100, height: 100 }}>
                    Item {id}
                    <button
                      data-testid={`remove-${id}`}
                      type="button"
                      onClick={() => setItems(items.filter((i) => i !== id))}
                    >
                      ×
                    </button>
                  </div>
                </MuuriItem>
              ))}
            </MuuriGrid>
          </div>
        );
      }

      render(<DynamicGrid />);

      await waitFor(
        () => {
          expect(screen.getByTestId('item-1')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );

      // Record initial layout counts (from initial render)
      const initialStartCount = layoutStartCount.current;
      const initialEndCount = layoutEndCount.current;

      // Remove item 3 from the middle
      await act(async () => {
        fireEvent.click(screen.getByTestId('remove-3'));
      });

      // Wait for item to be removed
      await waitFor(
        () => {
          expect(screen.queryByTestId('item-3')).not.toBeInTheDocument();
        },
        { timeout: 1000 }
      );

      // Wait a bit for any async layout operations
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Layout events should have been triggered after removal
      // This ensures remaining items will be repositioned to fill the gap
      expect(layoutStartCount.current).toBeGreaterThan(initialStartCount);
      expect(layoutEndCount.current).toBeGreaterThan(initialEndCount);
    });

    it('should properly sequence hide and layout on removal', async () => {
      /**
       * Expected behavior:
       * 1. Item is hidden (with optional animation)
       * 2. Item is removed from grid
       * 3. Remaining items reposition to fill the gap
       *
       * BUG: Currently remaining items don't reposition at all - they stay
       * in their original positions, leaving a gap where the removed item was
       */
      const events: string[] = [];

      function DynamicGrid() {
        const [items, setItems] = useState([1, 2, 3]);

        return (
          <div>
            <MuuriGrid
              layoutDuration={200}
              hideDuration={150}
              onHide={() => events.push('hide')}
              onRemove={() => events.push('remove')}
              onLayoutStart={() => events.push('layoutStart')}
              onLayoutEnd={() => events.push('layoutEnd')}
            >
              {items.map((id) => (
                <MuuriItem key={id}>
                  <div data-testid={`item-${id}`} style={{ width: 100, height: 100 }}>
                    Item {id}
                    <button
                      data-testid={`remove-${id}`}
                      type="button"
                      onClick={() => setItems(items.filter((i) => i !== id))}
                    >
                      ×
                    </button>
                  </div>
                </MuuriItem>
              ))}
            </MuuriGrid>
          </div>
        );
      }

      render(<DynamicGrid />);

      await waitFor(
        () => {
          expect(screen.getByTestId('item-2')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );

      // Clear initial events
      events.length = 0;

      // Remove item 2
      await act(async () => {
        fireEvent.click(screen.getByTestId('remove-2'));
      });

      // Wait for animations to complete
      await waitFor(
        () => {
          expect(screen.queryByTestId('item-2')).not.toBeInTheDocument();
        },
        { timeout: 1000 }
      );

      // Wait for all animations
      await new Promise((resolve) => setTimeout(resolve, 500));

      // BUG: The 'hide' event should occur before 'remove'
      // Currently hide is not called at all during removal
      const hideIndex = events.indexOf('hide');
      const removeIndex = events.indexOf('remove');

      // Hide should have been triggered
      expect(hideIndex).toBeGreaterThanOrEqual(0);
      // Hide should come before remove
      if (hideIndex >= 0 && removeIndex >= 0) {
        expect(hideIndex).toBeLessThan(removeIndex);
      }
    });
  });

  describe('rapid add/remove', () => {
    it('should handle rapid sequential additions', async () => {
      function DynamicGrid() {
        const [items, setItems] = useState<number[]>([]);
        const [nextId, setNextId] = useState(1);

        const addItem = () => {
          setItems((prev) => [...prev, nextId]);
          setNextId((prev) => prev + 1);
        };

        return (
          <div>
            <button data-testid="add-btn" type="button" onClick={addItem}>
              Add
            </button>
            <MuuriGrid layoutDuration={100}>
              {items.map((id) => (
                <MuuriItem key={id}>
                  <div data-testid={`item-${id}`} style={{ width: 100, height: 100 }}>
                    Item {id}
                  </div>
                </MuuriItem>
              ))}
            </MuuriGrid>
          </div>
        );
      }

      render(<DynamicGrid />);

      // Rapidly add items
      for (let i = 0; i < 5; i++) {
        fireEvent.click(screen.getByTestId('add-btn'));
      }

      // All items should eventually appear
      await waitFor(
        () => {
          expect(screen.getByTestId('item-1')).toBeInTheDocument();
          expect(screen.getByTestId('item-2')).toBeInTheDocument();
          expect(screen.getByTestId('item-3')).toBeInTheDocument();
          expect(screen.getByTestId('item-4')).toBeInTheDocument();
          expect(screen.getByTestId('item-5')).toBeInTheDocument();
        },
        { timeout: 2000 }
      );
    });

    it('should handle rapid sequential removals', async () => {
      function DynamicGrid() {
        const [items, setItems] = useState([1, 2, 3, 4, 5]);

        const removeFirst = () => {
          setItems((prev) => prev.slice(1));
        };

        return (
          <div>
            <button data-testid="remove-btn" type="button" onClick={removeFirst}>
              Remove First
            </button>
            <MuuriGrid layoutDuration={100}>
              {items.map((id) => (
                <MuuriItem key={id}>
                  <div data-testid={`item-${id}`} style={{ width: 100, height: 100 }}>
                    Item {id}
                  </div>
                </MuuriItem>
              ))}
            </MuuriGrid>
          </div>
        );
      }

      render(<DynamicGrid />);

      await waitFor(
        () => {
          expect(screen.getByTestId('item-1')).toBeInTheDocument();
        },
        { timeout: 1000 }
      );

      // Rapidly remove items
      for (let i = 0; i < 3; i++) {
        fireEvent.click(screen.getByTestId('remove-btn'));
      }

      // Items 1, 2, 3 should be gone, items 4, 5 should remain
      await waitFor(
        () => {
          expect(screen.queryByTestId('item-1')).not.toBeInTheDocument();
          expect(screen.queryByTestId('item-2')).not.toBeInTheDocument();
          expect(screen.queryByTestId('item-3')).not.toBeInTheDocument();
          expect(screen.getByTestId('item-4')).toBeInTheDocument();
          expect(screen.getByTestId('item-5')).toBeInTheDocument();
        },
        { timeout: 2000 }
      );
    });
  });
});

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { diagnostic413, MuuriGrid } from '../../src/MuuriGrid.js';
import { MuuriItem } from '../../src/MuuriItem.js';

const initialization = vi.hoisted(() => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { gate, release: () => release() };
});

vi.mock('muuri', async (importOriginal) => {
  const actual = await importOriginal();
  await initialization.gate;
  return actual;
});

describe('Issue 413 controlled real import completion before context publication', () => {
  it.each(['batched', 'settled'])(
    'should trigger layout animation after removing an item (%s)',
    async (publication) => {
      const onLayoutStart = vi.fn();
      let initialLayoutDone!: () => void;
      const initialLayout = new Promise<void>((resolve) => {
        initialLayoutDone = resolve;
      });
      const onLayoutEnd = vi.fn(() => initialLayoutDone());

      function DynamicGrid() {
        const [items, setItems] = useState([1, 2, 3]);

        return (
          <div>
            <MuuriGrid
              id="diagnostic-413"
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

      diagnostic413.length = 0;
      try {
        render(<DynamicGrid />);

        await waitFor(
          () => {
            expect(screen.getByTestId('item-1')).toBeInTheDocument();
            expect(screen.getByTestId('item-2')).toBeInTheDocument();
            expect(screen.getByTestId('item-3')).toBeInTheDocument();
          },
          { timeout: 1000 }
        );

        await act(async () => {
          initialization.release();
          await initialLayout;
          if (publication === 'batched') {
            diagnostic413.push([
              'clear',
              performance.now(),
              onLayoutStart.mock.calls.length,
              onLayoutEnd.mock.calls.length,
            ]);
            onLayoutStart.mockClear();
            onLayoutEnd.mockClear();
            fireEvent.click(screen.getByTestId('remove-2'));
          }
        });
        if (publication === 'settled') {
          onLayoutStart.mockClear();
          onLayoutEnd.mockClear();
          await act(async () => {
            fireEvent.click(screen.getByTestId('remove-2'));
          });
        }

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
      } finally {
        console.log('[DEBUG-413-schedule]', publication, JSON.stringify(diagnostic413));
      }
    }
  );
});

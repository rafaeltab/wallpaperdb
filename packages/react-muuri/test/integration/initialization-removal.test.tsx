import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type Muuri from 'muuri';
import { createRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MuuriGrid } from '../../src/MuuriGrid.js';
import { MuuriItem } from '../../src/MuuriItem.js';

const initialization = vi.hoisted(() => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { gate, release: () => release() };
});

vi.mock('muuri', async (importOriginal) => {
  // Keep the real module; only control its existing asynchronous publication.
  const actual = await importOriginal();
  await initialization.gate;
  return actual;
});

describe('removal around initial grid context publication', () => {
  it.each(['batched', 'settled'])(
    'should trigger layout animation after removing an item (%s)',
    async (publication) => {
      const gridRef = createRef<Muuri>();
      const onRemove = vi.fn();
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
              ref={gridRef}
              onRemove={onRemove}
              layoutDuration={300}
              onLayoutStart={onLayoutStart}
              onLayoutEnd={onLayoutEnd}
            >
              {items.map((id) => (
                <MuuriItem key={id} data-testid={`native-item-${id}`}>
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

      await act(async () => {
        // Let native initialization finish without committing React's queued context yet.
        initialization.release();
        await initialLayout;
        if (publication === 'batched') {
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

      await waitFor(
        () => {
          expect(onLayoutStart).toHaveBeenCalled();
        },
        { timeout: 1000 }
      );

      expect(onLayoutEnd).toHaveBeenCalled();
      expect(gridRef.current?.getItems().map((item) => item.getElement()?.dataset.testid)).toEqual([
        'native-item-1',
        'native-item-3',
      ]);
      expect(onRemove).toHaveBeenCalledTimes(1);
      expect(onRemove).toHaveBeenCalledWith(expect.any(Array), [1]);
    }
  );
});

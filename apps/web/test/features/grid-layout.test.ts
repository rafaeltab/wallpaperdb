import { describe, expect, it } from 'vitest';
import { type LayoutItem, layoutGrid } from '@/features/grid-layout';

function assertPacking(
  items: LayoutItem[],
  result: ReturnType<typeof layoutGrid>,
  gridWidth: number
) {
  expect(result.slots).toHaveLength(items.length * 2);
  for (let i = 0; i < items.length; i++) {
    const x = result.slots[i * 2];
    const y = result.slots[i * 2 + 1];
    expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    if (items[i].width <= gridWidth) expect(x + items[i].width).toBeLessThanOrEqual(gridWidth);
    expect(y + items[i].height).toBeLessThanOrEqual(result.height);
    for (let j = i + 1; j < items.length; j++) {
      const otherX = result.slots[j * 2];
      const otherY = result.slots[j * 2 + 1];
      expect(
        x + items[i].width <= otherX ||
          otherX + items[j].width <= x ||
          y + items[i].height <= otherY ||
          otherY + items[j].height <= y
      ).toBe(true);
    }
  }
}

describe('grid layout', () => {
  it('packs in input order from the lowest row then leftmost space', () => {
    const items = [
      { id: 'a', width: 50, height: 30 },
      { id: 'b', width: 50, height: 20 },
      { id: 'c', width: 50, height: 10 },
    ];
    const result = layoutGrid({ items, gridWidth: 100 });
    expect(result).toEqual({ slots: [0, 0, 50, 0, 50, 20], height: 30 });
    assertPacking(items, result, 100);
  });

  it('reserves a viewport-centered expanded item and preserves original slot order', () => {
    const items = [
      { id: 'a', width: 20, height: 20 },
      { id: 'expanded', width: 60, height: 40 },
      { id: 'c', width: 30, height: 10 },
    ];
    const result = layoutGrid({
      items,
      gridWidth: 100,
      expandedItemId: 'expanded',
      viewportCenter: { x: 50, y: 50 },
    });
    expect(result.slots.slice(2, 4)).toEqual([20, 30]);
    assertPacking(items, result, 100);
  });

  it.each([
    { x: -10, y: -10, expected: [0, 0] },
    { x: 1000, y: 50, expected: [40, 30] },
  ])('clamps expanded placement to the grid at $x,$y', ({ x, y, expected }) => {
    expect(
      layoutGrid({
        items: [{ id: 'a', width: 60, height: 40 }],
        gridWidth: 100,
        expandedItemId: 'a',
        viewportCenter: { x, y },
      }).slots
    ).toEqual(expected);
  });

  it('falls back to ordinary packing when expansion has no center or the item disappeared', () => {
    const items = [
      { id: 'a', width: 50, height: 20 },
      { id: 'b', width: 50, height: 20 },
    ];
    const plain = layoutGrid({ items, gridWidth: 100 });
    expect(layoutGrid({ items, gridWidth: 100, expandedItemId: 'a' })).toEqual(plain);
    expect(
      layoutGrid({
        items,
        gridWidth: 100,
        expandedItemId: 'missing',
        viewportCenter: { x: 50, y: 10 },
      })
    ).toEqual(plain);
  });

  it('adds horizontal margins without changing height, and handles an empty grid', () => {
    expect(
      layoutGrid({ items: [{ id: 'a', width: 50, height: 20 }], gridWidth: 100, marginOffset: 8 })
    ).toEqual({ slots: [8, 0], height: 20 });
    expect(layoutGrid({ items: [], gridWidth: 0 })).toEqual({ slots: [], height: 0 });
  });

  it('places oversized items in their own rows without overlapping following items', () => {
    const items = [
      { id: 'a', width: 120, height: 30 },
      { id: 'b', width: 50, height: 20 },
      { id: 'c', width: 150, height: 10 },
    ];
    assertPacking(items, layoutGrid({ items, gridWidth: 100 }), 100);
  });

  it('keeps varied rectangles and expanded reservations disjoint across deterministic batches', () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let batch = 0; batch < 40; batch++) {
      const items = Array.from({ length: 20 }, (_, index) => ({
        id: String(index),
        width: 10 + Math.floor(random() * 90),
        height: 10 + Math.floor(random() * 90),
      }));
      const options = {
        items,
        gridWidth: 100,
        ...(batch % 2 ? { expandedItemId: '4', viewportCenter: { x: 50, y: 80 } } : {}),
      };
      const result = layoutGrid(options);
      assertPacking(items, result, 100);
      expect(layoutGrid(options)).toEqual(result);
    }
  });
});

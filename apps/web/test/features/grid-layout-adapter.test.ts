import { describe, expect, it } from 'vitest';
import { createMuuriLayout, type GridLayoutState } from '@/features/grid-layout/adapters/muuri';

function item(id: string, width: number, height: number) {
  const root = document.createElement('div');
  const content = document.createElement('div');
  content.dataset.itemId = id;
  root.append(content);
  return { getElement: () => root, getWidth: () => width, getHeight: () => height };
}

describe('Muuri layout adapter', () => {
  it('translates measured DOM items and rereads expansion state with the same layout callback', () => {
    const items = [item('a', 50, 20), item('b', 50, 30)];
    let state: GridLayoutState = { expandedItemKey: null, viewportCenter: null, marginOffset: 8 };
    const layout = createMuuriLayout(() => state);
    const results: {
      id: number;
      items: typeof items;
      slots: number[];
      styles: { height: string };
    }[] = [];
    layout(null, 1, items, 100, 0, (result) => {
      results.push(result);
    });
    expect(results[0]).toEqual({ id: 1, items, slots: [8, 0, 58, 0], styles: { height: '30px' } });
    expect(results[0].items).toBe(items);
    state = { expandedItemKey: 'b', viewportCenter: { x: 50, y: 50 }, marginOffset: 8 };
    layout(null, 2, items, 100, 0, (result) => {
      results.push(result);
    });
    expect(results[1].slots.slice(2, 4)).toEqual([33, 35]);
    expect(results[1].styles.height).toBe('65px');
  });

  it('handles missing identity elements and an empty grid', () => {
    const layout = createMuuriLayout(() => ({
      expandedItemKey: 'missing',
      viewportCenter: { x: 50, y: 50 },
      marginOffset: 0,
    }));
    const missing = {
      getElement: () => document.createElement('div'),
      getWidth: () => 50,
      getHeight: () => 20,
    };
    layout(null, 1, [missing], 100, 0, (result) => {
      expect(result.slots).toEqual([0, 0]);
    });
    layout(null, 2, [], 0, 0, (result) => {
      expect(result).toMatchObject({ slots: [], styles: { height: '0px' } });
    });
  });
});

import type { LayoutFunction, MuuriItemInstance } from '@wallpaperdb/react-muuri';
import { layoutGrid } from '../index';

export interface GridLayoutState {
  expandedItemKey: string | null;
  viewportCenter: { x: number; y: number } | null;
  marginOffset: number;
}

type MeasuredItem = Pick<MuuriItemInstance, 'getElement' | 'getWidth' | 'getHeight'>;

export function createMuuriLayout(readState: () => GridLayoutState) {
  return (<TItem extends MeasuredItem>(
    _grid: unknown,
    layoutId: number,
    items: TItem[],
    gridWidth: number,
    _gridHeight: number,
    callback: (result: {
      id: number;
      items: TItem[];
      slots: number[];
      styles: { height: string };
    }) => void
  ) => {
    const { expandedItemKey, viewportCenter, marginOffset } = readState();
    const measured = items.map((item, index) => ({
      id:
        item.getElement()?.querySelector('[data-item-id]')?.getAttribute('data-item-id') ??
        `muuri-${index}`,
      width: item.getWidth(),
      height: item.getHeight(),
    }));
    const { slots, height } = layoutGrid({
      items: measured,
      gridWidth,
      expandedItemId: expandedItemKey,
      viewportCenter,
      marginOffset,
    });
    callback({ id: layoutId, items, slots, styles: { height: `${height}px` } });
  }) satisfies LayoutFunction;
}

import type { GridLayout, GridLayoutOptions } from './contract';
import { binPackLayout } from './packing';

export function layoutGrid({
  items,
  gridWidth,
  expandedItemId,
  viewportCenter,
  marginOffset = 0,
}: GridLayoutOptions): GridLayout {
  const expandedIndex = viewportCenter ? items.findIndex((item) => item.id === expandedItemId) : -1;
  const expanded = items[expandedIndex];
  const reserved =
    expanded && viewportCenter
      ? {
          x: Math.max(
            0,
            Math.min(viewportCenter.x - expanded.width / 2, gridWidth - expanded.width)
          ),
          y: Math.max(0, viewportCenter.y - expanded.height / 2),
          width: expanded.width,
          height: expanded.height,
        }
      : null;
  const others = items.filter((_, index) => index !== expandedIndex);
  const otherSlots = binPackLayout(others, gridWidth, reserved);
  const slots: number[] = [];
  let otherIndex = 0;
  let height = 0;
  for (let index = 0; index < items.length; index++) {
    const [x, y] =
      index === expandedIndex && reserved
        ? [reserved.x, reserved.y]
        : [otherSlots[otherIndex * 2], otherSlots[otherIndex++ * 2 + 1]];
    slots.push(x + marginOffset, y);
    height = Math.max(height, y + items[index].height);
  }
  return { slots, height };
}

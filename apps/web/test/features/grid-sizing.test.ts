import { expect, it } from 'vitest';
import { generateSkeletonItems, getDefaultSpan, gridCellSize, gridItemDimensions } from '@/features/grid-layout';

it('distributes columns across the available width including gaps', () => {
  expect(gridCellSize(1000, 200, 10)).toBe(237.5);
  expect(gridCellSize(180, 200, 10)).toBe(160);
  expect(gridCellSize(0, 200, 10)).toBe(0);
  expect(gridCellSize(15, 200, 10)).toBe(0);
});

it('preserves aspect ratio and caps expanded images at native and viewport dimensions', () => {
  const item = { id: 'a', src: '/a', width: 500, height: 250, aspectRatio: 2 };
  expect(getDefaultSpan(item)).toEqual({ cols: 2, rows: 1 });
  const base = gridItemDimensions(item, { cols: 2, rows: 1 }, false, 200, 10, 1000, 800);
  expect(base).toEqual({ width: 420, height: 215, margin: 5 });
  const expanded = gridItemDimensions(item, { cols: 2, rows: 1 }, true, 200, 10, 1000, 800);
  expect(expanded).toEqual({ width: 510, height: 260, margin: 5 });
  const limited = gridItemDimensions(item, { cols: 1, rows: 1 }, true, 200, 10, 250, 200);
  expect(limited.width - 10).toBeCloseTo(227.5);
  expect((limited.width - 10) / (limited.height - 10)).toBeCloseTo(2);
});

it('creates stable varied skeleton identities across appended pages', () => {
  const initial = generateSkeletonItems(6);
  const appended = generateSkeletonItems(2, 6);
  expect(new Set([...initial, ...appended].map(item => item.id)).size).toBe(8);
  expect(new Set(initial.map(item => item.aspectRatio)).size).toBe(6);
  expect(appended[0].aspectRatio).toBe(initial[0].aspectRatio);
});

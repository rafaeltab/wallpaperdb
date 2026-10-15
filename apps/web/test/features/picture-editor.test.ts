import { expect, it } from 'vitest';
import { initialPictureCrop, movePictureCrop, zoomPictureCrop, wheelPictureCrop, pinchPictureCrop, pictureCropNeedsEnlargement } from '@/features/picture-editor';

it.each([
  { size: 511, width: 512, height: 512, expected: true },
  { size: 512, width: 512, height: 512, expected: false },
  { size: 513, width: 512, height: 512, expected: false },
  { size: 256, width: 256, height: 128, expected: false },
  { size: 256, width: 257, height: 128, expected: true },
  { size: 256, width: 128, height: 257, expected: true },
])('reports enlargement for $size retained pixels against $width by $height output', ({ size, width, height, expected }) => {
  const crop = initialPictureCrop({ width: size, height: size });
  expect(pictureCropNeedsEnlargement(crop, { width, height })).toBe(expected);
});

it('frames a landscape source centrally and clamps dragging to covered source pixels', () => {
  const crop = initialPictureCrop({ width: 800, height: 400 });
  expect(crop).toEqual({ x: 200, y: 0, size: 400, zoom: 1, maxZoom: 6.25, lowResolution: false });
  expect(movePictureCrop(crop, { width: 800, height: 400 }, -500, 500)).toMatchObject({ x: 400, y: 0 });
  expect(movePictureCrop(crop, { width: 800, height: 400 }, 500, -500)).toMatchObject({ x: 0, y: 0 });
});

it('caps zoom at a 64-pixel source region and keeps edge crops covered', () => {
  const source = { width: 800, height: 400 };
  const edge = movePictureCrop(initialPictureCrop(source), source, -900, 0);
  expect(zoomPictureCrop(edge, source, 100)).toMatchObject({ x: 568, y: 168, size: 64, zoom: 6.25 });
  expect(zoomPictureCrop(zoomPictureCrop(edge, source, 100), source, 0)).toMatchObject({ x: 400, y: 0, size: 400, zoom: 1 });
});

it('permits small sources with a warning and no additional zoom', () => {
  const source = { width: 32, height: 100 };
  const crop = initialPictureCrop(source);
  expect(crop).toMatchObject({ x: 0, y: 34, size: 32, zoom: 1, maxZoom: 1, lowResolution: true });
  expect(zoomPictureCrop(crop, source, 10)).toEqual(crop);
});

it('zooms wheel input in either direction with the same source-region and low-resolution limits', () => {
  const source = { width: 800, height: 400 };
  const crop = initialPictureCrop(source);
  expect(wheelPictureCrop(crop, source, -346.57359028).zoom).toBeCloseTo(2);
  expect(wheelPictureCrop(crop, source, -10000)).toMatchObject({ size: 64, zoom: 6.25 });
  expect(wheelPictureCrop(wheelPictureCrop(crop, source, -10000), source, 10000)).toEqual(crop);
  const small = { width: 32, height: 48 };
  expect(wheelPictureCrop(initialPictureCrop(small), small, -10000)).toEqual(initialPictureCrop(small));
});

it('scales a pinch around the current crop and ignores coincident touch points', () => {
  const source = { width: 800, height: 400 };
  const crop = initialPictureCrop(source);
  expect(pinchPictureCrop(crop, source, 100, 200)).toMatchObject({ x: 300, y: 100, size: 200, zoom: 2 });
  expect(pinchPictureCrop(crop, source, 100, 10000)).toMatchObject({ size: 64, zoom: 6.25 });
  expect(pinchPictureCrop(crop, source, 0, 100)).toEqual(crop);
  expect(pinchPictureCrop(crop, source, 100, 0)).toEqual(crop);
  const small = { width: 32, height: 48 };
  expect(pinchPictureCrop(initialPictureCrop(small), small, 100, 200)).toEqual(initialPictureCrop(small));
});

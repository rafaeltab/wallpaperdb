import { expect, it } from 'vitest';
import { initialPictureCrop, movePictureCrop, zoomPictureCrop } from '@/features/picture-editor';

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

import type { PictureCrop, PictureDimensions } from './contract';

const clamp = (value: number, maximum: number) => Math.max(0, Math.min(value, maximum));

export function initialPictureCrop(source: PictureDimensions): PictureCrop {
  const size = Math.min(source.width, source.height);
  return {
    x: (source.width - size) / 2,
    y: (source.height - size) / 2,
    size,
    zoom: 1,
    maxZoom: Math.max(1, size / 64),
    lowResolution: size < 64,
  };
}

/** Drag deltas use source pixels; moving the image right moves the crop left. */
export function movePictureCrop(
  crop: PictureCrop,
  source: PictureDimensions,
  deltaX: number,
  deltaY: number
): PictureCrop {
  return {
    ...crop,
    x: clamp(crop.x - deltaX, source.width - crop.size),
    y: clamp(crop.y - deltaY, source.height - crop.size),
  };
}

export function zoomPictureCrop(
  crop: PictureCrop,
  source: PictureDimensions,
  requestedZoom: number
): PictureCrop {
  const zoom = Math.max(1, Math.min(requestedZoom, crop.maxZoom));
  const size = Math.min(source.width, source.height) / zoom;
  return {
    ...crop,
    zoom,
    size,
    x: clamp(crop.x + (crop.size - size) / 2, source.width - size),
    y: clamp(crop.y + (crop.size - size) / 2, source.height - size),
  };
}

/** Wheel distances are CSS pixels; 500 pixels change zoom by a factor of e. */
export function wheelPictureCrop(
  crop: PictureCrop,
  source: PictureDimensions,
  deltaPixels: number
): PictureCrop {
  return zoomPictureCrop(crop, source, crop.zoom * Math.exp(-deltaPixels / 500));
}

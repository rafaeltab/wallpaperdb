export type PictureCanvas = OffscreenCanvas | HTMLCanvasElement;

export function pictureCanvas(width: number, height: number, offscreen: boolean): PictureCanvas {
  if (offscreen) return new OffscreenCanvas(width, height);
  const result = document.createElement('canvas');
  result.width = width;
  result.height = height;
  return result;
}

export function pictureCanvasContext(canvas: PictureCanvas) {
  return 'convertToBlob' in canvas
    ? canvas.getContext('2d', { alpha: true, colorSpace: 'srgb' })
    : canvas.getContext('2d', { alpha: true, colorSpace: 'srgb' });
}

export async function encodePictureCanvas(canvas: PictureCanvas, type: string, quality?: number) {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Unable to encode this picture.'))),
      type,
      quality
    )
  );
}

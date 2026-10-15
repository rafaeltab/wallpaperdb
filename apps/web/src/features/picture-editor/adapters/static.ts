import type { PictureDimensions } from '../index';
import { encodePictureCanvas, pictureCanvasContext, type PictureCanvas } from './canvas';
import type { PictureJob, PictureJobResult } from './protocol';

interface PictureRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Adapters own decoded pixels, draw scheduling, cancellation and native encode lifetimes. */
export async function staticPictureJob(
  _job: Extract<PictureJob, { action: 'preview' }>,
  source: PictureDimensions,
  canvas: PictureCanvas,
  draw: (
    context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    crop: PictureRegion
  ) => void | Promise<void>
): Promise<Extract<PictureJobResult, { ok: true }>> {
  const scale = Math.min(1, 1024 / Math.max(source.width, source.height));
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = pictureCanvasContext(canvas);
  if (!context) throw new Error('Unable to create the picture canvas.');
  context.imageSmoothingQuality = 'high';
  await draw(context, { x: 0, y: 0, width: source.width, height: source.height });
  const blob = await encodePictureCanvas(canvas, 'image/png');
  return { ok: true, blob, width: source.width, height: source.height };
}

import type { PictureDimensions } from '../index';
import { encodePictureCanvas, pictureCanvasContext, type PictureCanvas } from './canvas';
import type { PictureJob, PictureJobResult } from './protocol';
import { withoutPictureMetadata } from './webp';

interface PictureRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Adapters own decoded pixels, draw scheduling, cancellation and native encode lifetimes. */
export async function staticPictureJob(
  job: PictureJob,
  source: PictureDimensions,
  canvas: PictureCanvas,
  draw: (
    context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    crop: PictureRegion
  ) => void | Promise<void>
): Promise<Extract<PictureJobResult, { ok: true }>> {
  const scale = Math.min(1, 1024 / Math.max(source.width, source.height));
  canvas.width =
    job.action === 'preview'
      ? Math.max(1, Math.round(source.width * scale))
      : job.policy.output.width;
  canvas.height =
    job.action === 'preview'
      ? Math.max(1, Math.round(source.height * scale))
      : job.policy.output.height;
  const context = pictureCanvasContext(canvas);
  if (!context) throw new Error('Unable to create the picture canvas.');
  context.imageSmoothingQuality = 'high';
  const crop =
    job.action === 'preview'
      ? { x: 0, y: 0, width: source.width, height: source.height }
      : { x: job.crop.x, y: job.crop.y, width: job.crop.size, height: job.crop.size };
  await draw(context, crop);
  const encoded = await encodePictureCanvas(
    canvas,
    job.action === 'preview' ? 'image/png' : 'image/webp',
    job.action === 'process' ? job.policy.encoding.staticQuality / 100 : undefined
  );
  const blob = job.action === 'process' ? await withoutPictureMetadata(encoded) : encoded;
  return { ok: true, blob, width: source.width, height: source.height };
}

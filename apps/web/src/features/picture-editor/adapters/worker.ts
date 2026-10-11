import type { PictureJob, PictureJobResult } from './protocol';
import { withoutPictureMetadata } from './webp';

// Each worker owns one job. Termination cancels native decode/encode and frees its bitmap.
self.addEventListener('message', async (event: MessageEvent<PictureJob>) => {
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
    self.postMessage({
      ok: false,
      message: 'Worker image processing is unavailable.',
      unsupported: true,
    } satisfies PictureJobResult);
    return;
  }
  let bitmap: ImageBitmap | undefined;
  try {
    const job = event.data;
    bitmap = await createImageBitmap(job.file, {
      imageOrientation: 'from-image',
      colorSpaceConversion: 'default',
    });
    const width =
      job.action === 'preview'
        ? Math.max(
            1,
            Math.round(bitmap.width * Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height)))
          )
        : job.policy.output.width;
    const height =
      job.action === 'preview'
        ? Math.max(
            1,
            Math.round(bitmap.height * Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height)))
          )
        : job.policy.output.height;
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { alpha: true, colorSpace: 'srgb' });
    if (!context) throw new Error('Unable to create the picture canvas.');
    context.imageSmoothingQuality = 'high';
    if (job.action === 'preview') context.drawImage(bitmap, 0, 0, width, height);
    else
      context.drawImage(
        bitmap,
        job.crop.x,
        job.crop.y,
        job.crop.size,
        job.crop.size,
        0,
        0,
        width,
        height
      );
    const encoded = await canvas.convertToBlob({
      type: job.action === 'preview' ? 'image/png' : 'image/webp',
      quality: job.action === 'process' ? job.policy.encoding.staticQuality / 100 : undefined,
    });
    const blob = job.action === 'process' ? await withoutPictureMetadata(encoded) : encoded;
    self.postMessage({
      ok: true,
      blob,
      width: bitmap.width,
      height: bitmap.height,
    } satisfies PictureJobResult);
  } catch (cause) {
    self.postMessage({
      ok: false,
      message: cause instanceof Error ? cause.message : 'Unable to process this picture.',
    } satisfies PictureJobResult);
  } finally {
    bitmap?.close();
  }
});

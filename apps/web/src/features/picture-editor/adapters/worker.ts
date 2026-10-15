import type { PictureJob, PictureJobResult } from './protocol';
import { gifPictureJob } from './gif';
import { staticPictureJob } from './static';

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
    const gif = await gifPictureJob(job, new AbortController().signal, true);
    if (gif) {
      self.postMessage(gif);
      return;
    }
    bitmap = await createImageBitmap(job.file, {
      imageOrientation: 'from-image',
      colorSpaceConversion: 'default',
    });
    const image = bitmap;
    const canvas = new OffscreenCanvas(1, 1);
    const result = await staticPictureJob(job, bitmap, canvas, (context, crop) => {
      context.drawImage(
        image,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        canvas.width,
        canvas.height
      );
    });
    self.postMessage(result);
  } catch (cause) {
    self.postMessage({
      ok: false,
      message: cause instanceof Error ? cause.message : 'Unable to process this picture.',
    } satisfies PictureJobResult);
  } finally {
    bitmap?.close();
  }
});

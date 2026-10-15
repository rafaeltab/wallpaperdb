import type { PictureDecodedLimits, PictureSource } from '../index';
import type { PictureJob, PictureJobResult } from './protocol';
import { gifPictureJob } from './gif';
import { withoutPictureMetadata } from './webp';
import { yieldPictureWork } from './yield';
import { validateSourceDimensions } from './source';
import { validateJpegColor } from './jpeg';

function cancelled() {
  return new DOMException('Picture processing cancelled.', 'AbortError');
}

async function validateSource(file: Blob, signal: AbortSignal) {
  const bytes = new Uint8Array(await file.slice(0, 30).arrayBuffer());
  signal.throwIfAborted();
  const text = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png =
    bytes[0] === 137 &&
    text(1, 4) === 'PNG' &&
    bytes[4] === 13 &&
    bytes[5] === 10 &&
    bytes[6] === 26 &&
    bytes[7] === 10;
  const webp = text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP';
  const gif = ['GIF87a', 'GIF89a'].includes(text(0, 6));
  if (!jpeg && !png && !webp && !gif)
    throw new Error('Choose a valid JPEG, PNG, WebP, or GIF picture.');
  if (gif) return;
  if (png) {
    let offset = 8;
    while (offset + 12 <= file.size) {
      const header = new Uint8Array(await file.slice(offset, offset + 8).arrayBuffer());
      signal.throwIfAborted();
      const size = new DataView(header.buffer).getUint32(0);
      const type = String.fromCharCode(...header.slice(4, 8));
      if (offset + 12 + size > file.size) break;
      if (type === 'acTL')
        throw new Error(
          'Animated PNG pictures are not supported as an editor source. Choose a GIF to preserve animation.'
        );
      if (type === 'cICP')
        throw new Error(
          "This picture's color interpretation is not supported. Choose another picture."
        );
      offset += 12 + size;
      if (type === 'IEND') {
        await validateSourceDimensions(file, 'png', signal);
        return;
      }
    }
    throw new Error('Choose a valid PNG picture.');
  }
  if (webp) {
    let chunks = 0;
    if (text(12, 16) === 'VP8X' && bytes[20] & 2)
      throw new Error(
        'Animated WebP pictures are not supported as an editor source. Choose a GIF to preserve animation.'
      );
    for (let offset = 12; offset + 8 <= file.size; ) {
      if (++chunks % 256 === 0) await yieldPictureWork(signal);
      const header = new Uint8Array(await file.slice(offset, offset + 8).arrayBuffer());
      signal.throwIfAborted();
      const type = String.fromCharCode(...header.slice(0, 4));
      if (type === 'ANMF')
        throw new Error(
          'Animated WebP pictures are not supported as an editor source. Choose a GIF to preserve animation.'
        );
      const size = new DataView(header.buffer).getUint32(4, true);
      const next = offset + 8 + size + (size % 2);
      if (next > file.size) throw new Error('Unable to decode this WebP picture.');
      offset = next;
    }
  }
  await validateSourceDimensions(file, jpeg ? 'jpeg' : 'webp', signal);
  if (jpeg) await validateJpegColor(file, signal);
}

let fallbackReservation: Promise<void> | undefined;

function waitForFallback(reservation: Promise<void>, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(cancelled());
    };
    signal.addEventListener('abort', abort, { once: true });
    reservation.then(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    });
  });
}

async function fallback(job: PictureJob, signal: AbortSignal) {
  while (fallbackReservation) await waitForFallback(fallbackReservation, signal);
  signal.throwIfAborted();
  let release = () => {};
  fallbackReservation = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    return await fallbackWork(job, signal);
  } finally {
    fallbackReservation = undefined;
    release();
  }
}

async function fallbackWork(
  job: PictureJob,
  signal: AbortSignal
): Promise<Extract<PictureJobResult, { ok: true }>> {
  await yieldPictureWork(signal);
  const gif = await gifPictureJob(job, signal, false);
  if (gif) return gif;
  let image: ImageBitmap | HTMLImageElement;
  let sourceUrl: string | undefined;
  if (typeof createImageBitmap !== 'undefined') {
    image = await createImageBitmap(job.file, {
      imageOrientation: 'from-image',
      colorSpaceConversion: 'default',
    });
  } else {
    image = new Image();
    sourceUrl = URL.createObjectURL(job.file);
    image.src = sourceUrl;
    try {
      await image.decode();
    } catch (cause) {
      URL.revokeObjectURL(sourceUrl);
      throw cause;
    }
  }
  try {
    signal.throwIfAborted();
    const sourceWidth = image instanceof HTMLImageElement ? image.naturalWidth : image.width;
    const sourceHeight = image instanceof HTMLImageElement ? image.naturalHeight : image.height;
    const scale = Math.min(1, 1024 / Math.max(sourceWidth, sourceHeight));
    const width =
      job.action === 'preview'
        ? Math.max(1, Math.round(sourceWidth * scale))
        : job.policy.output.width;
    const height =
      job.action === 'preview'
        ? Math.max(1, Math.round(sourceHeight * scale))
        : job.policy.output.height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: true, colorSpace: 'srgb' });
    if (!context) throw new Error('Unable to create the picture canvas.');
    context.imageSmoothingQuality = 'high';
    const crop =
      job.action === 'preview'
        ? { x: 0, y: 0, width: sourceWidth, height: sourceHeight }
        : { x: job.crop.x, y: job.crop.y, width: job.crop.size, height: job.crop.size };
    // Bound each synchronous draw and let cancellation and painting run between strips.
    for (let y = 0; y < height; y += 64) {
      await yieldPictureWork(signal);
      const strip = Math.min(64, height - y);
      context.drawImage(
        image,
        crop.x,
        crop.y + (crop.height * y) / height,
        crop.width,
        (crop.height * strip) / height,
        0,
        y,
        width,
        strip
      );
    }
    const encoded = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (result) =>
          result ? resolve(result) : reject(new Error('Unable to encode this picture.')),
        job.action === 'preview' ? 'image/png' : 'image/webp',
        job.action === 'process' ? job.policy.encoding.staticQuality / 100 : undefined
      )
    );
    const blob = job.action === 'process' ? await withoutPictureMetadata(encoded) : encoded;
    signal.throwIfAborted();
    return { ok: true, blob, width: sourceWidth, height: sourceHeight };
  } finally {
    if ('close' in image) image.close();
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  }
}

async function runJob(
  job: PictureJob,
  signal: AbortSignal
): Promise<Extract<PictureJobResult, { ok: true }>> {
  signal.throwIfAborted();
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined')
    return fallback(job, signal);
  const result = await new Promise<PictureJobResult>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    } catch {
      resolve({ ok: false, message: 'Worker unavailable.', unsupported: true });
      return;
    }
    const cleanup = () => {
      signal.removeEventListener('abort', abort);
      worker.terminate();
    };
    const abort = () => {
      cleanup();
      reject(cancelled());
    };
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<PictureJobResult>) => {
      cleanup();
      resolve(event.data);
    };
    worker.onerror = () => {
      cleanup();
      resolve({ ok: false, message: 'Worker unavailable.', unsupported: true });
    };
    worker.postMessage(job);
  });
  signal.throwIfAborted();
  if (result.ok) return result;
  if (result.unsupported) return fallback(job, signal);
  throw new Error(`Unable to process this picture. ${result.message}`);
}

/** Public browser adapter: source pixels stay local; only process() returns uploadable bytes. */
export async function openPictureSource(
  file: Blob,
  signal: AbortSignal,
  limits?: PictureDecodedLimits
): Promise<PictureSource<Blob>> {
  await validateSource(file, signal);
  const preview = await runJob({ action: 'preview', file, limits }, signal);
  let disposed = false;
  const work = new Set<AbortController>();
  return {
    width: preview.width,
    height: preview.height,
    preview: preview.blob,
    async process(crop, policy, signal) {
      if (disposed) throw cancelled();
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.throwIfAborted();
      signal.addEventListener('abort', abort, { once: true });
      work.add(controller);
      try {
        const result = await runJob(
          { action: 'process', file, crop, policy, limits },
          controller.signal
        );
        if (result.blob.type !== policy.output.mimeType)
          throw new Error('This browser cannot encode WebP pictures. Try another browser.');
        if (result.blob.size > policy.maxOutputBytes)
          throw new Error(
            `Processed picture exceeds the ${policy.maxOutputBytes.toLocaleString()} byte limit. Choose another picture.`
          );
        return result.blob;
      } finally {
        signal.removeEventListener('abort', abort);
        work.delete(controller);
      }
    },
    dispose() {
      disposed = true;
      for (const controller of work) controller.abort();
      work.clear();
    },
  };
}

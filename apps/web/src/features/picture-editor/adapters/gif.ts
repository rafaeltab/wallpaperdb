import {
  decodePictureGif,
  encodePictureAnimation,
  pictureAnimationFramePlan,
  type PictureEncodedFrame,
} from '../index';
import { withoutPictureMetadata } from './webp';
import { yieldPictureWork } from './yield';
import type { PictureJob, PictureJobResult } from './protocol';

type PictureCanvas = OffscreenCanvas | HTMLCanvasElement;
function canvas(width: number, height: number, offscreen: boolean): PictureCanvas {
  if (offscreen) return new OffscreenCanvas(width, height);
  const result = document.createElement('canvas');
  result.width = width;
  result.height = height;
  return result;
}
function context(canvas: PictureCanvas) {
  return 'convertToBlob' in canvas
    ? canvas.getContext('2d', { alpha: true, colorSpace: 'srgb' })
    : canvas.getContext('2d', { alpha: true, colorSpace: 'srgb' });
}
async function encode(canvas: PictureCanvas, type: string, quality?: number) {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Unable to encode this picture.'))),
      type,
      quality
    )
  );
}

interface GifAttempt {
  result: Extract<PictureJobResult, { ok: true }>;
  animated: boolean;
  durations: number[];
}

async function gifPictureAttempt(
  job: PictureJob,
  signal: AbortSignal,
  offscreen: boolean,
  bytes: Uint8Array,
  quality?: number,
  plan?: ReadonlyMap<number, number>
): Promise<GifAttempt> {
  const decoder = decodePictureGif(bytes);
  let source: PictureCanvas | undefined;
  let output: PictureCanvas | undefined;
  let sourceContext: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  let outputContext: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  const frames: PictureEncodedFrame[] = [];
  const durations: number[] = [];
  try {
    let step = decoder.next();
    while (!step.done) {
      await yieldPictureWork(signal);
      const value = step.value;
      if (value.kind === 'size') {
        source = canvas(value.width, value.height, offscreen);
        const scale = Math.min(1, 1024 / Math.max(value.width, value.height));
        output = canvas(
          job.action === 'preview'
            ? Math.max(1, Math.round(value.width * scale))
            : job.policy.output.width,
          job.action === 'preview'
            ? Math.max(1, Math.round(value.height * scale))
            : job.policy.output.height,
          offscreen
        );
        sourceContext = context(source);
        outputContext = context(output);
        if (!sourceContext || !outputContext)
          throw new Error('Unable to create the picture canvas.');
        outputContext.imageSmoothingQuality = 'high';
      } else if (value.kind === 'frame') {
        const index = durations.length;
        durations.push(value.duration);
        const duration = plan ? plan.get(index) : value.duration;
        if (duration === undefined) {
          step = decoder.next();
          continue;
        }
        if (!source || !output || !sourceContext || !outputContext)
          throw new Error('Invalid GIF canvas.');
        const rows = Math.max(1, Math.floor(16384 / value.width));
        for (let y = 0; y < value.height; y += rows) {
          await yieldPictureWork(signal);
          const height = Math.min(rows, value.height - y);
          const pixels = new Uint8ClampedArray(
            value.pixels.buffer,
            value.pixels.byteOffset + y * value.width * 4,
            height * value.width * 4
          );
          sourceContext.putImageData(new ImageData(pixels, value.width, height), 0, y);
        }
        outputContext.clearRect(0, 0, output.width, output.height);
        const crop = job.action === 'preview' ? { x: 0, y: 0, size: 0 } : job.crop;
        const width = job.action === 'preview' ? value.width : crop.size;
        const height = job.action === 'preview' ? value.height : crop.size;
        for (let y = 0; y < output.height; y += 64) {
          await yieldPictureWork(signal);
          const rows = Math.min(64, output.height - y);
          outputContext.drawImage(
            source,
            crop.x,
            crop.y + (height * y) / output.height,
            width,
            (height * rows) / output.height,
            0,
            y,
            output.width,
            rows
          );
        }
        const blob = await encode(
          output,
          job.action === 'preview' ? 'image/png' : 'image/webp',
          quality === undefined ? undefined : quality / 100
        );
        signal.throwIfAborted();
        if (job.action === 'preview')
          return {
            result: { ok: true, blob, width: value.width, height: value.height },
            animated: false,
            durations,
          };
        if (blob.type !== 'image/webp')
          throw new Error('This browser cannot encode WebP pictures. Try another browser.');
        frames.push({ bytes: new Uint8Array(await blob.arrayBuffer()), duration });
        if (frames.length > 1 && !job.policy.animation.available)
          throw new Error('Animated pictures are unavailable under the current picture rules.');
      }
      step = decoder.next();
    }
    signal.throwIfAborted();
    if (!source || job.action !== 'process' || !frames.length)
      throw new Error('Unable to decode this GIF picture.');
    await yieldPictureWork(signal);
    if (step.value.animated && !job.policy.animation.available)
      throw new Error('Animated pictures are unavailable under the current picture rules.');
    const blob = !step.value.animated
      ? await withoutPictureMetadata(
          new Blob([new Uint8Array(frames[0].bytes)], { type: 'image/webp' })
        )
      : new Blob(
          encodePictureAnimation(
            frames,
            job.policy.output,
            step.value.loop,
            Number.MAX_SAFE_INTEGER
          ),
          {
            type: 'image/webp',
          }
        );
    signal.throwIfAborted();
    return {
      result: { ok: true, blob, width: source.width, height: source.height },
      animated: step.value.animated,
      durations,
    };
  } finally {
    decoder.return({ loop: 1, frameCount: 0, animated: false });
    if (source) {
      source.width = 0;
      source.height = 0;
    }
    if (output) {
      output.width = 0;
      output.height = 0;
    }
  }
}

/** Both the worker and cooperative UI fallback own all fitting attempts for one source. */
export async function gifPictureJob(
  job: PictureJob,
  signal: AbortSignal,
  offscreen: boolean
): Promise<Extract<PictureJobResult, { ok: true }> | undefined> {
  const header = new Uint8Array(await job.file.slice(0, 6).arrayBuffer());
  signal.throwIfAborted();
  if (!['GIF87a', 'GIF89a'].includes(String.fromCharCode(...header))) return undefined;
  const bytes = new Uint8Array(await job.file.arrayBuffer());
  signal.throwIfAborted();
  if (job.action === 'preview')
    return (await gifPictureAttempt(job, signal, offscreen, bytes)).result;
  let quality = job.policy.encoding.animationQuality;
  const minimumQuality = Math.min(20, quality);
  let durations: number[] = [];
  while (true) {
    await yieldPictureWork(signal);
    const attempt = await gifPictureAttempt(job, signal, offscreen, bytes, quality);
    durations = attempt.durations;
    if (!attempt.animated || attempt.result.blob.size <= job.policy.maxOutputBytes)
      return attempt.result;
    if (quality === minimumQuality) break;
    quality = Math.max(minimumQuality, quality - 20);
  }
  let previous = pictureAnimationFramePlan(durations, 0);
  for (const interval of [40, 50]) {
    const plan = pictureAnimationFramePlan(durations, interval);
    if (
      plan.length === previous.length &&
      plan.every(
        (frame, index) =>
          frame.index === previous[index].index && frame.duration === previous[index].duration
      )
    )
      continue;
    previous = plan;
    await yieldPictureWork(signal);
    const attempt = await gifPictureAttempt(
      job,
      signal,
      offscreen,
      bytes,
      minimumQuality,
      new Map(plan.map(({ index, duration }) => [index, duration]))
    );
    if (attempt.result.blob.size <= job.policy.maxOutputBytes) return attempt.result;
  }
  throw new Error(
    `Processed animation cannot fit the ${job.policy.maxOutputBytes.toLocaleString()} byte limit. Choose another picture.`
  );
}

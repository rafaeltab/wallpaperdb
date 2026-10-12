import { decodePictureGif, encodePictureAnimation, type PictureEncodedFrame } from '../index';
import { withoutPictureMetadata } from './webp';
import { yieldPictureWork } from './yield';
import type { PictureJob, PictureJobResult } from './protocol';
import { defaultPictureDecodedLimits } from '../contract';

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

/** Both the worker and cooperative UI fallback own a whole decode/compose/encode job. */
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
  const limits = job.limits ?? defaultPictureDecodedLimits;
  const decoder = decodePictureGif(bytes, limits);
  let source: PictureCanvas | undefined;
  let output: PictureCanvas | undefined;
  let sourceContext: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  let outputContext: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  const frames: PictureEncodedFrame[] = [];
  let encodedBytes = 0;
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
        if (
          job.action === 'process' &&
          frames.length > 0 &&
          (frames.length + 1) * job.policy.output.width * job.policy.output.height * 4 >
            limits.maxDecodedBytes
        )
          throw new Error('This GIF exceeds the decoded byte limit.');
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
          job.action === 'process' ? job.policy.encoding.animationQuality / 100 : undefined
        );
        signal.throwIfAborted();
        if (job.action === 'preview')
          return { ok: true, blob, width: value.width, height: value.height };
        if (blob.type !== 'image/webp')
          throw new Error('This browser cannot encode WebP pictures. Try another browser.');
        const retainedLimit = Math.max(
          limits.maxDecodedBytes,
          job.policy.maxOutputBytes,
          job.policy.output.width * job.policy.output.height * 4
        );
        if (blob.size > retainedLimit - encodedBytes)
          throw new Error('This GIF exceeds the decoded byte limit.');
        encodedBytes += blob.size;
        frames.push({ bytes: new Uint8Array(await blob.arrayBuffer()), duration: value.duration });
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
    if (
      step.value.animated &&
      frames.length * job.policy.output.width * job.policy.output.height * 4 >
        limits.maxDecodedBytes
    )
      throw new Error('This GIF exceeds the decoded byte limit.');
    const blob = !step.value.animated
      ? await withoutPictureMetadata(
          new Blob([new Uint8Array(frames[0].bytes)], { type: 'image/webp' })
        )
      : new Blob(
          encodePictureAnimation(
            frames,
            job.policy.output,
            step.value.loop,
            job.policy.maxOutputBytes
          ),
          {
            type: 'image/webp',
          }
        );
    signal.throwIfAborted();
    return { ok: true, blob, width: source.width, height: source.height };
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

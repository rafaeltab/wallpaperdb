import {
  decodePictureGif,
  encodePictureAnimation,
  pictureAnimationFramePlan,
  type PictureEncodedFrame,
} from '../index';
import { withoutPictureMetadata } from './webp';
import { yieldPictureWork } from './yield';
import type { PictureJob, PictureJobResult } from './protocol';
import { pictureGifSourceByteLimit, type PictureDecodedLimits } from '../contract';

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

class OutputFrameLimitError extends Error {}

async function gifFrameDurations(
  bytes: Uint8Array,
  limits: PictureDecodedLimits,
  signal: AbortSignal,
  offscreen: boolean,
  maximumFrames: number
) {
  const decoder = decodePictureGif(bytes, limits);
  const durations: number[] = [];
  try {
    let step = decoder.next();
    while (!step.done) {
      await yieldPictureWork(signal, offscreen);
      if (step.value.kind === 'frame') {
        if (durations.length === maximumFrames)
          throw new OutputFrameLimitError('This GIF exceeds the decoded byte limit.');
        durations.push(step.value.duration);
      }
      step = decoder.next();
    }
    return durations;
  } finally {
    decoder.return({ loop: 1, frameCount: 0, animated: false });
  }
}

async function gifPictureAttempt(
  job: PictureJob,
  signal: AbortSignal,
  offscreen: boolean,
  bytes: Uint8Array,
  limits: PictureDecodedLimits,
  quality?: number,
  plan?: ReadonlyMap<number, number>
): Promise<GifAttempt> {
  function outputDimensions(width: number, height: number) {
    const scale = Math.min(1, 1024 / Math.max(width, height));
    return {
      width:
        job.action === 'preview' ? Math.max(1, Math.round(width * scale)) : job.policy.output.width,
      height:
        job.action === 'preview'
          ? Math.max(1, Math.round(height * scale))
          : job.policy.output.height,
    };
  }
  const decoder = decodePictureGif(bytes, limits, (width, height) => {
    const output = outputDimensions(width, height);
    return (width * height + output.width * output.height) * 4;
  });
  let source: PictureCanvas | undefined;
  let output: PictureCanvas | undefined;
  let sourceContext: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  let outputContext: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  const frames: PictureEncodedFrame[] = [];
  const durations: number[] = [];
  let encodedBytes = 0;
  try {
    let step = decoder.next();
    while (!step.done) {
      await yieldPictureWork(signal, offscreen);
      const value = step.value;
      if (value.kind === 'size') {
        source = canvas(value.width, value.height, offscreen);
        const dimensions = outputDimensions(value.width, value.height);
        output = canvas(dimensions.width, dimensions.height, offscreen);
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
        if (
          job.action === 'process' &&
          frames.length > 0 &&
          (frames.length + 1) * job.policy.output.width * job.policy.output.height * 4 >
            limits.maxDecodedBytes
        )
          throw new OutputFrameLimitError('This GIF exceeds the decoded byte limit.');
        if (!source || !output || !sourceContext || !outputContext)
          throw new Error('Invalid GIF canvas.');
        const rows = Math.max(1, Math.floor(16384 / value.width));
        for (let y = 0; y < value.height; y += rows) {
          await yieldPictureWork(signal, offscreen);
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
          await yieldPictureWork(signal, offscreen);
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
        const retainedLimit = Math.max(
          limits.maxDecodedBytes,
          job.policy.maxOutputBytes,
          job.policy.output.width * job.policy.output.height * 4
        );
        if (blob.size > retainedLimit - encodedBytes)
          throw new Error('This GIF exceeds the decoded byte limit.');
        encodedBytes += blob.size;
        frames.push({ bytes: new Uint8Array(await blob.arrayBuffer()), duration });
        if (frames.length > 1 && !job.policy.animation.available)
          throw new Error('Animated pictures are unavailable under the current picture rules.');
      }
      step = decoder.next();
    }
    signal.throwIfAborted();
    if (!source || !output || job.action !== 'process' || !frames.length)
      throw new Error('Unable to decode this GIF picture.');
    await yieldPictureWork(signal, offscreen);
    if (step.value.animated && !job.policy.animation.available)
      throw new Error('Animated pictures are unavailable under the current picture rules.');
    if (
      step.value.animated &&
      frames.length * job.policy.output.width * job.policy.output.height * 4 >
        limits.maxDecodedBytes
    )
      throw new OutputFrameLimitError('This GIF exceeds the decoded byte limit.');
    let blob: Blob;
    if (!step.value.animated) {
      const staticFrame =
        quality === job.policy.encoding.staticQuality
          ? new Blob([new Uint8Array(frames[0].bytes)], { type: 'image/webp' })
          : await encode(output, 'image/webp', job.policy.encoding.staticQuality / 100);
      signal.throwIfAborted();
      if (staticFrame.type !== 'image/webp')
        throw new Error('This browser cannot encode WebP pictures. Try another browser.');
      blob = await withoutPictureMetadata(staticFrame);
    } else {
      blob = new Blob(
        encodePictureAnimation(frames, job.policy.output, step.value.loop, Number.MAX_SAFE_INTEGER),
        {
          type: 'image/webp',
        }
      );
    }
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
  const limits = job.limits;
  if (
    !limits ||
    ![limits.maxPixels, limits.maxDecodedBytes].every(
      (value) => Number.isSafeInteger(value) && value > 0
    )
  )
    throw new Error('Picture resource limits are unavailable. Refresh your Profile and try again.');
  if (job.file.size > pictureGifSourceByteLimit)
    throw new Error('This GIF exceeds the 50 MiB source file limit.');
  const bytes = new Uint8Array(await job.file.arrayBuffer());
  signal.throwIfAborted();
  if (job.action === 'preview')
    return (await gifPictureAttempt(job, signal, offscreen, bytes, limits)).result;
  let quality = job.policy.encoding.animationQuality;
  const minimumQuality = Math.min(20, quality);
  let durations: number[] = [];
  let frameLimitError: OutputFrameLimitError | undefined;
  while (true) {
    await yieldPictureWork(signal, offscreen);
    let attempt: GifAttempt;
    try {
      attempt = await gifPictureAttempt(job, signal, offscreen, bytes, limits, quality);
    } catch (cause) {
      if (!(cause instanceof OutputFrameLimitError)) throw cause;
      frameLimitError = cause;
      const maximumOutputFrames = Math.floor(
        limits.maxDecodedBytes / (job.policy.output.width * job.policy.output.height * 4)
      );
      // GIF intervals are at least 20 ms. The 50 ms plan groups at most three
      // source frames, plus at most two trailing frames merged into the last group.
      durations = await gifFrameDurations(
        bytes,
        limits,
        signal,
        offscreen,
        maximumOutputFrames * 3 + 2
      );
      break;
    }
    durations = attempt.durations;
    if (!attempt.animated || attempt.result.blob.size <= job.policy.maxOutputBytes)
      return attempt.result;
    if (quality === minimumQuality) break;
    quality = Math.max(minimumQuality, quality - 20);
  }
  let previous = pictureAnimationFramePlan(durations, 0);
  let usablePlan = false;
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
    if (
      plan.length * job.policy.output.width * job.policy.output.height * 4 >
      limits.maxDecodedBytes
    )
      continue;
    usablePlan = true;
    await yieldPictureWork(signal, offscreen);
    const attempt = await gifPictureAttempt(
      job,
      signal,
      offscreen,
      bytes,
      limits,
      minimumQuality,
      new Map(plan.map(({ index, duration }) => [index, duration]))
    );
    if (attempt.result.blob.size <= job.policy.maxOutputBytes) return attempt.result;
  }
  if (frameLimitError && !usablePlan) throw frameLimitError;
  throw new Error(
    `Processed animation cannot fit the ${job.policy.maxOutputBytes.toLocaleString()} byte limit. Choose another picture.`
  );
}

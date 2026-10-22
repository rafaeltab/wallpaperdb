import { afterEach, expect, it, vi } from 'vitest';
import { initialPictureCrop, movePictureCrop, zoomPictureCrop } from '../../src/features/picture-editor';
import { openPictureSource } from '../../src/features/picture-editor/adapters/browser';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const policy = {
  output: { width: 512, height: 512, mimeType: 'image/webp' as const, colorSpace: 'srgb' as const },
  maxOutputBytes: 5242880,
  animation: { available: true },
  encoding: { staticQuality: 85, animationQuality: 85 },
};
const resolvedLimits = { maxPixels: 20_000_000, maxDecodedBytes: 80_000_000 };

async function fixture(name = "profile-disposal.gif") {
  const response = await fetch(new URL(`../fixtures/${name}`, import.meta.url));
  expect(response.ok).toBe(true);
  return response.blob();
}

it('keeps an already fitting animation equivalent at the exact canonical byte limit', async () => {
  const controller = new AbortController();
  const source = await openPictureSource(await fixture(), controller.signal, resolvedLimits);
  try {
    const crop = initialPictureCrop(source);
    const original = await source.process(crop, policy, controller.signal);
    const exact = await source.process(crop, { ...policy, maxOutputBytes: original.size }, controller.signal);
    expect(new Uint8Array(await exact.arrayBuffer())).toEqual(new Uint8Array(await original.arrayBuffer()));
    const decoder = new ImageDecoder({ data: new Uint8Array(await exact.arrayBuffer()), type: 'image/webp' });
    try {
      await decoder.tracks.ready;
      expect(decoder.tracks.selectedTrack?.frameCount).toBe(4);
      expect(decoder.tracks.selectedTrack?.repetitionCount).toBe(2);
      const durations = [];
      for (let frameIndex = 0; frameIndex < 4; frameIndex++) {
        const { image } = await decoder.decode({ frameIndex });
        durations.push(image.duration);
        expect([image.displayWidth, image.displayHeight]).toEqual([512, 512]);
        image.close();
      }
      expect(durations).toEqual([100000, 200000, 300000, 400000]);
    } finally { decoder.close(); }
  } finally { source.dispose(); }
});

async function decodedAnimation(blob: Blob, positions: [number, number][] = [[32, 256], [448, 256]]) {
  const decoder = new ImageDecoder({ data: new Uint8Array(await blob.arrayBuffer()), type: blob.type });
  try {
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    if (!track) throw new Error('Missing animation track');
    const frames = [];
    for (let frameIndex = 0; frameIndex < track.frameCount; frameIndex++) {
      const { image } = await decoder.decode({ frameIndex, completeFramesOnly: true });
      try {
        const canvas = new OffscreenCanvas(image.displayWidth, image.displayHeight);
        const context = canvas.getContext('2d', { colorSpace: 'srgb' });
        if (!context) throw new Error('Missing sRGB canvas');
        context.drawImage(image, 0, 0);
        frames.push({
          width: image.displayWidth, height: image.displayHeight,
          duration: image.duration, timestamp: image.timestamp,
          colorSpace: context.getImageData(0, 0, 1, 1).colorSpace,
          samples: positions.map(([x, y]) => Array.from(context.getImageData(x, y, 1, 1).data)),
        });
        canvas.width = 0; canvas.height = 0;
      } finally { image.close(); }
    }
    return { repetitions: track.repetitionCount, frames };
  } finally { decoder.close(); }
}

it.each(['worker', 'fallback'])('previews every GIF interval within the decoded bounds with the real %s codec', async (mode) => {
  if (mode === 'fallback') vi.stubGlobal('Worker', undefined);
  const file = await fixture();
  const source = await openPictureSource(file, new AbortController().signal, resolvedLimits);
  try {
    const preview = await decodedAnimation(source.preview, [[16, 64], [48, 64]]);
    expect(preview.frames.map((frame) => frame.duration)).toEqual([100000, 200000, 300000, 400000]);
    expect(preview.repetitions).toBe(2);
    for (const frame of preview.frames) expect(frame).toMatchObject({ width: 224, height: 128 });
    expect(preview.frames.map((frame) => frame.samples[1][3])).toEqual([255, 255, 255, 0]);
    await expect(openPictureSource(file, new AbortController().signal, { maxPixels: 28672, maxDecodedBytes: 344064 })).rejects.toThrow('decoded byte limit');
  } finally { source.dispose(); }
});

function manyFrameGif(delay: number, count = 80) {
  const header = '47494638396101000100800000000000ffffff21ff0b4e45545343415045322e300301020000';
  const frames = Array.from({ length: count }, (_, index) =>
    `21f90400${delay.toString(16).padStart(2, '0')}0000002c0000000001000100000202${(index >> 1) % 2 ? '4c' : '44'}0100`).join('');
  return new Blob([Uint8Array.from((header + frames + '3b').match(/../g)!, (byte) => parseInt(byte, 16))], { type: 'image/gif' });
}

it.each(['worker', 'fallback'])('coalesces source-admitted short frames before exceeding the output budget with the real %s codec', async (mode) => {
  if (mode === 'fallback') vi.stubGlobal('Worker', undefined);
  const controller = new AbortController();
  const source = await openPictureSource(manyFrameGif(2), controller.signal,
    { maxPixels: 16_000_000, maxDecodedBytes: 64 * 1024 * 1024 });
  try {
    const fitted = await source.process(initialPictureCrop(source), policy, controller.signal);
    expect(fitted.size).toBeLessThanOrEqual(policy.maxOutputBytes);
    const result = await decodedAnimation(fitted, [[256, 256]]);
    expect(result.repetitions).toBe(2);
    expect(result.frames).toHaveLength(40);
    expect(result.frames.map((frame) => frame.duration)).toEqual(Array(40).fill(40000));
    expect(result.frames.at(-1)!.timestamp! + result.frames.at(-1)!.duration!).toBe(1600000);
    result.frames.forEach((frame, index) => {
      expect(frame).toMatchObject({ width: 512, height: 512 });
      expect(frame.samples[0][3]).toBe(255);
      expect(frame.samples[0][0] > 128).toBe(index % 2 === 1);
    });
  } finally { source.dispose(); }
});

it('keeps normal-rate source frames subject to the output budget', async () => {
  const controller = new AbortController();
  const source = await openPictureSource(manyFrameGif(10), controller.signal,
    { maxPixels: 16_000_000, maxDecodedBytes: 64 * 1024 * 1024 });
  try {
    await expect(source.process(initialPictureCrop(source), policy, controller.signal)).rejects.toThrow('decoded byte limit');
  } finally { source.dispose(); }
});

it('reports an impossible byte limit after coalescing and keeps the source retryable', async () => {
  const controller = new AbortController();
  const source = await openPictureSource(manyFrameGif(2), controller.signal,
    { maxPixels: 16_000_000, maxDecodedBytes: 64 * 1024 * 1024 });
  try {
    const crop = initialPictureCrop(source);
    await expect(source.process(crop, { ...policy, maxOutputBytes: 1 }, controller.signal)).rejects.toThrow('animation cannot fit the 1 byte limit');
    const recovered = await source.process(crop, policy, controller.signal);
    expect((await decodedAnimation(recovered)).frames).toHaveLength(40);
  } finally { source.dispose(); }
});

it('accepts the largest short-frame run fitting the 50 ms plan, including its merged tail', async () => {
  const controller = new AbortController();
  const source = await openPictureSource(manyFrameGif(2, 194), controller.signal,
    { maxPixels: 16_000_000, maxDecodedBytes: 64 * 1024 * 1024 });
  try {
    const fitted = await source.process(initialPictureCrop(source), policy, controller.signal);
    const result = await decodedAnimation(fitted, [[256, 256]]);
    expect(result.frames).toHaveLength(64);
    expect(result.frames.at(-1)!.timestamp! + result.frames.at(-1)!.duration!).toBe(3880000);
  } finally { source.dispose(); }
});

it('rejects an unencodable frame count with a large valid source tail', async () => {
  const initial = new Uint8Array(await manyFrameGif(2, 195).arrayBuffer());
  const tail = new Uint8Array(4 * 1024 * 1024);
  for (let index = 0; index < tail.length; index += 2) { tail[index] = 1; tail[index + 1] = 65; }
  const file = new Blob([initial.subarray(0, -1), new Uint8Array([0x21, 0xfe]), tail,
    new Uint8Array([0, 0x3b])], { type: 'image/gif' });
  const controller = new AbortController();
  const source = await openPictureSource(file, controller.signal,
    { maxPixels: 16_000_000, maxDecodedBytes: 64 * 1024 * 1024 });
  try {
    await expect(source.process(initialPictureCrop(source), policy, controller.signal)).rejects.toThrow('decoded byte limit');
  } finally { source.dispose(); }
});

it.each(['worker', 'fallback'])('fits a normal-rate animation while preserving every interval and alpha with the real %s codec', async (mode) => {
  if (mode === 'fallback') vi.stubGlobal('Worker', undefined);
  const controller = new AbortController();
  const source = await openPictureSource(await fixture("profile-fitting.gif"), controller.signal, resolvedLimits);
  try {
    const crop = movePictureCrop(zoomPictureCrop(initialPictureCrop(source), source, 2), source, 0, 32);
    const initial = await source.process(crop, policy, controller.signal);
    const lowQuality = await source.process(crop, { ...policy, encoding: { ...policy.encoding, animationQuality: 20 } }, controller.signal);
    expect(lowQuality.size).toBeLessThan(initial.size);
    const limit = Math.ceil((initial.size + lowQuality.size) / 2);
    const fitted = await source.process(crop, { ...policy, maxOutputBytes: limit }, controller.signal);
    expect(fitted.size).toBeLessThanOrEqual(limit);
    const result = await decodedAnimation(fitted, [[256, 200], [256, 300]]);
    expect(result.repetitions).toBe(2);
    expect(result.frames.map((frame) => [frame.timestamp, frame.duration])).toEqual([[0, 100000], [100000, 200000], [300000, 300000], [600000, 400000]]);
    for (const frame of result.frames) expect(frame).toMatchObject({ width: 512, height: 512, colorSpace: 'srgb' });
    expect(result.frames.map((frame) => frame.samples.map((pixel) => pixel[3]))).toEqual([[0,255], [0,255], [0,255], [0,255]]);
    expect(new Set(result.frames.map((frame) => frame.samples[1].join(","))).size).toBe(4);
  } finally { source.dispose(); }
});

it.each(['worker', 'fallback'])('fits excessive frame rates without trimming elapsed time with the real %s codec', async (mode) => {
  if (mode === 'fallback') vi.stubGlobal('Worker', undefined);
  const controller = new AbortController();
  const source = await openPictureSource(await fixture('profile-fast-fitting.gif'), controller.signal, resolvedLimits);
  try {
    const crop = initialPictureCrop(source);
    const lowQualityPolicy = { ...policy, encoding: { ...policy.encoding, animationQuality: 20 } };
    const full = await source.process(crop, lowQualityPolicy, controller.signal);
    const limit = Math.floor(full.size * 0.75);
    const fitted = await source.process(crop, { ...lowQualityPolicy, maxOutputBytes: limit }, controller.signal);
    expect(fitted.size).toBeLessThanOrEqual(limit);
    const result = await decodedAnimation(fitted, [[256, 10], [256, 256]]);
    expect(result.repetitions).toBe(2);
    expect(result.frames.map((frame) => [frame.timestamp, frame.duration])).toEqual([[0, 40000], [40000, 40000]]);
    for (const frame of result.frames) expect(frame).toMatchObject({ width: 512, height: 512, colorSpace: 'srgb' });
    expect(result.frames.map((frame) => frame.samples.map((pixel) => pixel[3]))).toEqual([[0, 255], [0, 255]]);
    expect(new Set(result.frames.map((frame) => frame.samples[1].join(','))).size).toBe(2);
  } finally { source.dispose(); }
});

it.each(['worker', 'fallback'])('reports impossible fitting and keeps the source retryable with the real %s codec', async (mode) => {
  if (mode === 'fallback') vi.stubGlobal('Worker', undefined);
  const controller = new AbortController();
  let source: Awaited<ReturnType<typeof openPictureSource>> | undefined;
  try {
    source = await openPictureSource(await fixture('profile-fitting.gif'), controller.signal, resolvedLimits);
    const crop = initialPictureCrop(source);
    await expect(source.process(crop, { ...policy, maxOutputBytes: 1 }, controller.signal)).rejects.toThrow(/animation cannot fit the 1 byte limit/);
    const recovered = await source.process(crop, policy, controller.signal);
    const result = await decodedAnimation(recovered);
    expect(result.frames.map((frame) => frame.duration)).toEqual([100000, 200000, 300000, 400000]);
    expect(result.repetitions).toBe(2);
  } finally { source?.dispose(); vi.unstubAllGlobals(); }
});

it.each(['worker', 'fallback'])('cancels an observed pending fitting job and releases the real %s codec', async (mode) => {
  if (mode === 'fallback') vi.stubGlobal('Worker', undefined);
  const controller = new AbortController();
  let notifyStarted = () => {};
  let releaseEncode = () => {};
  const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
  const release = new Promise<void>((resolve) => { releaseEncode = resolve; });
  let source: Awaited<ReturnType<typeof openPictureSource>> | undefined;
  try {
    source = await openPictureSource(await fixture('profile-fitting.gif'), controller.signal, resolvedLimits);
    if (mode === 'worker') {
      const RealWorker = Worker;
      vi.stubGlobal('Worker', class extends RealWorker {
        override postMessage(message: unknown, options?: Transferable[] | StructuredSerializeOptions) {
          if (Array.isArray(options)) super.postMessage(message, options);
          else super.postMessage(message, options);
          notifyStarted();
        }
      });
    } else {
      const realEncode = HTMLCanvasElement.prototype.toBlob;
      vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback, type, quality) {
        realEncode.call(this, (blob) => {
          notifyStarted();
          void release.then(() => callback(blob));
        }, type, quality);
      });
    }
    const crop = initialPictureCrop(source);
    const processing = source.process(crop, { ...policy, maxOutputBytes: 1 }, controller.signal);
    const rejected = (async () => {
      await expect(processing).rejects.toMatchObject({ name: 'AbortError' });
    })();
    await started;
    controller.abort();
    releaseEncode();
    await rejected;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (mode === 'fallback') vi.stubGlobal('Worker', undefined);
    const recovered = await source.process(crop, policy, new AbortController().signal);
    expect((await decodedAnimation(recovered)).frames).toHaveLength(4);
  } finally { releaseEncode(); source?.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});


it.each(['worker', 'fallback'])('normalizes small and transparent static sources with the real %s codec', async (mode) => {
  if (mode === 'fallback') vi.stubGlobal('Worker', undefined);
  for (const name of ['profile-small.png', 'profile-transparent-p3.png']) {
    const response = await fetch(new URL(`../../../web-e2e/fixtures/${name}`, import.meta.url));
    expect(response.ok).toBe(true);
    const controller = new AbortController();
    const source = await openPictureSource(await response.blob(), controller.signal);
    try {
      const result = await source.process(initialPictureCrop(source), policy, controller.signal);
      const bitmap = await createImageBitmap(result);
      try {
        expect([bitmap.width, bitmap.height]).toEqual([512, 512]);
        const canvas = new OffscreenCanvas(512, 512);
        const context = canvas.getContext('2d', { colorSpace: 'srgb' });
        if (!context) throw new Error('Missing static-source canvas');
        context.drawImage(bitmap, 0, 0);
        if (name === 'profile-small.png') {
          expect(context.getImageData(0, 0, 1, 1).data[3]).toBe(255);
          expect(context.getImageData(511, 511, 1, 1).data[3]).toBe(255);
        } else {
          expect(context.getImageData(256, 10, 1, 1).data[3]).toBe(0);
          const sample = context.getImageData(256, 256, 1, 1).data;
          expect(sample[3]).toBe(128);
          for (const [index, expected] of [32, 180, 64].entries())
            expect(Math.abs(sample[index] - expected)).toBeLessThan(12);
        }
      } finally { bitmap.close(); }
    } finally { source.dispose(); }
  }
});

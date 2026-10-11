import { expect, it } from 'vitest';
import { initialPictureCrop } from '../../src/features/picture-editor';
import { openPictureSource } from '../../src/features/picture-editor/adapters/browser';

const policy = {
  output: { width: 512, height: 512, mimeType: 'image/webp' as const, colorSpace: 'srgb' as const },
  maxOutputBytes: 5242880,
  animation: { available: true },
  encoding: { staticQuality: 85, animationQuality: 85 },
};

async function fixture(name = "profile-disposal.gif") {
  const response = await fetch(new URL(`../fixtures/${name}`, import.meta.url));
  expect(response.ok).toBe(true);
  return response.blob();
}

it('keeps an already fitting animation equivalent at the exact canonical byte limit', async () => {
  const controller = new AbortController();
  const source = await openPictureSource(await fixture(), controller.signal);
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
  const decoder = new ImageDecoder({ data: new Uint8Array(await blob.arrayBuffer()), type: 'image/webp' });
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

it('fits a normal-rate animation by lowering quality while preserving every interval and alpha', async () => {
  const controller = new AbortController();
  const source = await openPictureSource(await fixture("profile-fitting.gif"), controller.signal);
  try {
    const crop = initialPictureCrop(source);
    const initial = await source.process(crop, policy, controller.signal);
    const lowQuality = await source.process(crop, { ...policy, encoding: { ...policy.encoding, animationQuality: 20 } }, controller.signal);
    expect(lowQuality.size).toBeLessThan(initial.size);
    const limit = Math.ceil((initial.size + lowQuality.size) / 2);
    const fitted = await source.process(crop, { ...policy, maxOutputBytes: limit }, controller.signal);
    expect(fitted.size).toBeLessThanOrEqual(limit);
    const result = await decodedAnimation(fitted, [[256, 10], [256, 256]]);
    expect(result.repetitions).toBe(2);
    expect(result.frames.map((frame) => [frame.timestamp, frame.duration])).toEqual([[0, 100000], [100000, 200000], [300000, 300000], [600000, 400000]]);
    for (const frame of result.frames) expect(frame).toMatchObject({ width: 512, height: 512, colorSpace: 'srgb' });
    expect(result.frames.map((frame) => frame.samples.map((pixel) => pixel[3]))).toEqual([[0,255], [0,255], [0,255], [0,255]]);
    expect(new Set(result.frames.map((frame) => frame.samples[1].join(","))).size).toBe(4);
  } finally { source.dispose(); }
});

it('fits excessive frame rates without trimming elapsed time or flattening the animation', async () => {
  const controller = new AbortController();
  const source = await openPictureSource(await fixture('profile-fast-fitting.gif'), controller.signal);
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

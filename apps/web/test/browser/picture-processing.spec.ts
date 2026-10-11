import { expect, it } from 'vitest';
import { initialPictureCrop } from '../../src/features/picture-editor';
import { openPictureSource } from '../../src/features/picture-editor/adapters/browser';

const policy = {
  output: { width: 512, height: 512, mimeType: 'image/webp' as const, colorSpace: 'srgb' as const },
  maxOutputBytes: 5242880,
  animation: { available: true },
  encoding: { staticQuality: 85, animationQuality: 85 },
};

async function fixture() {
  const response = await fetch(new URL('../fixtures/profile-disposal.gif', import.meta.url));
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

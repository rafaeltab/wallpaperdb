import 'reflect-metadata';
import type { WallpaperUploadedEvent } from '@wallpaperdb/events/schemas';
import { describe, expect, it, vi } from 'vitest';
import { ColorExtractionProcessor } from '../src/services/color-extraction-processor.js';
import type {
  ColorsExtractedPublisher,
  ImageHistogramProvider,
} from '../src/services/ports.js';

const wallpaper: WallpaperUploadedEvent['wallpaper'] = {
  id: 'wallpaper-1',
  userId: 'user-1',
  fileType: 'image',
  mimeType: 'image/png',
  fileSizeBytes: 123,
  width: 10,
  height: 20,
  aspectRatio: 0.5,
  storageBucket: 'wallpapers',
  storageKey: 'wallpaper-1/original.png',
  originalFilename: 'original.png',
  uploadedAt: '2025-01-01T00:00:00.000Z',
};

describe('ColorExtractionProcessor', () => {
  it('passes storage coordinates to extraction and publishes the exact result', async () => {
    const histogram = [0.1, 0.9];
    const extractHistogram = vi.fn().mockResolvedValue(histogram);
    const publishColorsExtracted = vi.fn().mockResolvedValue(undefined);
    const processor = new ColorExtractionProcessor(
      { extractHistogram } satisfies ImageHistogramProvider,
      { publishColorsExtracted } satisfies ColorsExtractedPublisher
    );

    await processor.extractColors(wallpaper);

    expect(extractHistogram).toHaveBeenCalledExactlyOnceWith(
      'wallpapers',
      'wallpaper-1/original.png'
    );
    expect(publishColorsExtracted).toHaveBeenCalledExactlyOnceWith(
      'wallpaper-1',
      histogram,
      'hsv'
    );
  });

  it('does not publish when histogram extraction fails', async () => {
    const failure = new Error('extract failed');
    const publishColorsExtracted = vi.fn();
    const processor = new ColorExtractionProcessor(
      { extractHistogram: vi.fn().mockRejectedValue(failure) },
      { publishColorsExtracted }
    );

    await expect(processor.extractColors(wallpaper)).rejects.toBe(failure);
    expect(publishColorsExtracted).not.toHaveBeenCalled();
  });

  it('propagates publisher failures', async () => {
    const failure = new Error('publish failed');
    const processor = new ColorExtractionProcessor(
      { extractHistogram: vi.fn().mockResolvedValue([1]) },
      { publishColorsExtracted: vi.fn().mockRejectedValue(failure) }
    );

    await expect(processor.extractColors(wallpaper)).rejects.toBe(failure);
  });
});

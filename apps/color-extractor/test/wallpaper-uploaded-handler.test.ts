import 'reflect-metadata';
import type { WallpaperUploadedEvent } from '@wallpaperdb/events/schemas';
import { describe, expect, it, vi } from 'vitest';
import { processWallpaperUploaded } from '../src/services/consumers/wallpaper-uploaded-consumer.service.js';
import type { ColorExtractionUseCase } from '../src/services/ports.js';

function event(fileType: 'image' | 'video'): WallpaperUploadedEvent {
  return {
    eventId: 'event-1',
    eventType: 'wallpaper.uploaded',
    timestamp: '2025-01-01T00:00:00.000Z',
    wallpaper: {
      id: 'wallpaper-1',
      userId: 'user-1',
      fileType,
      mimeType: fileType === 'image' ? 'image/png' : 'video/mp4',
      fileSizeBytes: 123,
      width: 10,
      height: 10,
      aspectRatio: 1,
      storageBucket: 'wallpapers',
      storageKey: 'wallpaper-1/original',
      originalFilename: 'original',
      uploadedAt: '2025-01-01T00:00:00.000Z',
    },
  };
}

describe('wallpaper uploaded handling policy', () => {
  it('extracts colors for images', async () => {
    const extractColors = vi.fn().mockResolvedValue(undefined);
    const useCase: ColorExtractionUseCase = { extractColors };
    const uploaded = event('image');

    await expect(processWallpaperUploaded(useCase, uploaded)).resolves.toBe(true);
    expect(extractColors).toHaveBeenCalledExactlyOnceWith(uploaded.wallpaper);
  });

  it('skips non-images', async () => {
    const extractColors = vi.fn();

    await expect(processWallpaperUploaded({ extractColors }, event('video'))).resolves.toBe(false);
    expect(extractColors).not.toHaveBeenCalled();
  });

  it('propagates extraction failures', async () => {
    const failure = new Error('extract failed');

    await expect(
      processWallpaperUploaded(
        { extractColors: vi.fn().mockRejectedValue(failure) },
        event('image')
      )
    ).rejects.toBe(failure);
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildAspectRatioFilter,
  buildWallpaperFilter,
  getAspectRatioBadgeLabel,
  getDeviceAspectRatioOptionLabel,
  getFormatBadgeLabel,
  resolveClosestAspectRatioPreset,
  parseBrowseSearch,
} from '@/lib/browse-filters';

describe('browse filters', () => {
  it('keeps only supported format values from route search', () => {
    expect(parseBrowseSearch({ after: 'cursor_123', format: 'png', aspectRatio: '16-9' })).toEqual({
      after: 'cursor_123',
      format: 'png',
      aspectRatio: '16-9',
    });

    expect(parseBrowseSearch({ after: 'cursor_123', format: 'gif', aspectRatio: '3-1' })).toEqual({
      after: 'cursor_123',
      format: undefined,
      aspectRatio: undefined,
    });
  });

  it('maps a selected format to the wallpaper query filter', () => {
    expect(buildWallpaperFilter(undefined)).toBeUndefined();
    expect(buildWallpaperFilter('jpeg')).toEqual({ variants: { format: 'image/jpeg' } });
    expect(buildWallpaperFilter('png')).toEqual({ variants: { format: 'image/png' } });
    expect(buildWallpaperFilter('webp')).toEqual({ variants: { format: 'image/webp' } });
  });

  it('maps preset and device aspect ratios to the wallpaper query filter', () => {
    expect(buildAspectRatioFilter(undefined, '16-9')).toBeUndefined();
    expect(buildAspectRatioFilter('21-9', '16-9')).toEqual({ variants: { aspectRatio: 21 / 9 } });
    expect(buildAspectRatioFilter('device', '16-10')).toEqual({ variants: { aspectRatio: 16 / 10 } });
  });

  it('resolves the nearest supported aspect-ratio preset for a device ratio', () => {
    expect(resolveClosestAspectRatioPreset(1920 / 1080)).toBe('16-9');
    expect(resolveClosestAspectRatioPreset(1512 / 982)).toBe('16-10');
    expect(resolveClosestAspectRatioPreset(1080 / 1920)).toBe('9-16');
  });

  it('formats active filter badges using user-facing labels', () => {
    expect(getFormatBadgeLabel('jpeg')).toBe('Format: JPEG');
    expect(getFormatBadgeLabel('png')).toBe('Format: PNG');
    expect(getFormatBadgeLabel('webp')).toBe('Format: WebP');
    expect(getAspectRatioBadgeLabel('16-10', '16-10')).toBe('Aspect ratio: 16:10');
    expect(getAspectRatioBadgeLabel('device', '16-9')).toBe('Aspect ratio: Device 16:9');
  });

  it('formats the live device option label using the resolved preset', () => {
    expect(getDeviceAspectRatioOptionLabel('16-9')).toBe('Device 16:9');
    expect(getDeviceAspectRatioOptionLabel('21-9')).toBe('Device 21:9');
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildWallpaperFilter,
  getFormatBadgeLabel,
  parseBrowseSearch,
} from '@/lib/browse-filters';

describe('browse filters', () => {
  it('keeps only supported format values from route search', () => {
    expect(parseBrowseSearch({ after: 'cursor_123', format: 'png' })).toEqual({
      after: 'cursor_123',
      format: 'png',
    });

    expect(parseBrowseSearch({ after: 'cursor_123', format: 'gif' })).toEqual({
      after: 'cursor_123',
      format: undefined,
    });
  });

  it('maps a selected format to the wallpaper query filter', () => {
    expect(buildWallpaperFilter(undefined)).toBeUndefined();
    expect(buildWallpaperFilter('jpeg')).toEqual({ variants: { format: 'image/jpeg' } });
    expect(buildWallpaperFilter('png')).toEqual({ variants: { format: 'image/png' } });
    expect(buildWallpaperFilter('webp')).toEqual({ variants: { format: 'image/webp' } });
  });

  it('formats active filter badges using user-facing labels', () => {
    expect(getFormatBadgeLabel('jpeg')).toBe('Format: JPEG');
    expect(getFormatBadgeLabel('png')).toBe('Format: PNG');
    expect(getFormatBadgeLabel('webp')).toBe('Format: WebP');
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildAspectRatioFilter,
  buildWallpaperFilter,
  getAspectRatioBadgeLabel,
  getDeviceAspectRatioOptionLabel,
  buildWallpaperSort,
  getColorBadgeLabel,
  getFormatBadgeLabel,
  parseBrowseSearch,
  resolveClosestAspectRatioPreset,
} from '@/features/browse';

describe('browse filters', () => {
  it('preserves an exact Profile ID in the URL and combines it with wallpaper variant filters', () => {
    const state = parseBrowseSearch({ profileId: 'user_Ada', profile: 'Ada Lovelace' });

    expect(state).toMatchObject({ profileId: 'user_Ada' });
    expect(buildWallpaperFilter(undefined, undefined, state.profileId)).toEqual({
      profileId: 'user_Ada',
    });
    expect(buildWallpaperFilter('png', 16 / 9, state.profileId)).toEqual({
      profileId: 'user_Ada',
      variants: { format: 'image/png', aspectRatio: 16 / 9 },
    });
    expect(parseBrowseSearch({ profileId: '' }).profileId).toBeUndefined();
    expect(parseBrowseSearch({ profileId: ['user_Ada'] }).profileId).toBeUndefined();
  });

  it('keeps only supported format values from route search', () => {
    expect(parseBrowseSearch({ after: 'cursor_123', color: '#ff0000', format: 'png', aspectRatio: '16-9' })).toEqual({
      after: 'cursor_123',
      color: '#FF0000',
      format: 'png',
      aspectRatio: '16-9',
    });

    expect(parseBrowseSearch({ after: 'cursor_123', color: 'red', format: 'gif', aspectRatio: '3-1' })).toEqual({
      after: 'cursor_123',
      color: undefined,
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

  it('maps the selected hex color to one favorite vibe target without a requested proportion', () => {
    expect(buildWallpaperSort(undefined)).toBeUndefined();
    expect(buildWallpaperSort('invalid')).toBeUndefined();
    expect(buildWallpaperSort('#ff0000')).toEqual({
      color: {
        mode: 'VIBE',
        quality: 'FAVORITE',
        targets: [{ color: '#FF0000' }],
      },
    });
  });

  it('formats active filter badges using user-facing labels', () => {
    expect(getColorBadgeLabel('#ff0000')).toBe('Color: #FF0000');
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

describe('advanced browse color preferences', () => {
  it('restores a mixed color search from the URL and sends complete per-target utilities', () => {
    const state = parseBrowseSearch({ colors: [
      { color: '#004aff', quality: 'RELAXED' },
      { name: 'DARK', percent: 0, quality: 'STRICT' },
      { name: 'MONOCHROMATIC', percent: 40 },
    ], profileId: 'artist', format: 'png', after: 'cursor' });
    expect(state.colors).toEqual([
      { color: '#004AFF', quality: 'RELAXED' },
      { name: 'DARK', percent: 0, quality: 'STRICT' },
      { name: 'MONOCHROMATIC', percent: 40, quality: 'FAVORITE' },
    ]);
    expect(buildWallpaperSort(state.colors)).toEqual({ color: { targets: [
      { color: '#004AFF', mode: 'VIBE', quality: 'RELAXED' },
      { name: 'DARK', mode: 'PROPORTIONS', percent: 0, quality: 'STRICT' },
      { name: 'MONOCHROMATIC', mode: 'PROPORTIONS', percent: 40, quality: 'FAVORITE' },
    ] } });
  });
  it.each([
    [{ color: '#bad' }], [{ name: 'UNKNOWN' }], [{ color: '#004AFF', name: 'BLUE' }],
    [{ name: 'DARK', percent: 15 }], [{ name: 'DARK', quality: 'BAD' }],
    [{ name: 'DARK', percent: 70 }, { name: 'LIGHT', percent: 70 }],
    Array.from({length:11},()=>({name:'DARK'})),
  ].map(colors => ({ colors })))('does not admit malformed or over-budget URL preferences %j', ({ colors }) => {
    expect(parseBrowseSearch({ colors }).colors).toBeUndefined();
  });
});

import { expect, it } from 'vitest';
import { updateBrowseSearch, normalizeProfileSearch } from '@/features/browse';

it('resets pagination when changing a filter and preserves the other filters', () => {
  const previous = { after: 'page-2', profileId: 'ada', format: 'png' as const, color: '#FF0000' };
  expect(updateBrowseSearch(previous, { aspectRatio: '16-9' })).toEqual({
    ...previous, after: undefined, aspectRatio: '16-9',
  });
  expect(updateBrowseSearch(previous, { profileId: undefined })).toEqual({
    ...previous, after: undefined, profileId: undefined,
  });
  expect(previous.after).toBe('page-2');
});

it('replaces the legacy color with composition preferences, including clearing', () => {
  const previous = { color: '#FF0000', after: 'page-2', profileId: 'ada' };
  expect(updateBrowseSearch(previous, { colors: [] })).toEqual({
    ...previous, after: undefined, color: undefined, colors: undefined,
  });
  const colors = [{ color: '#00FF00', quality: 'FAVORITE' as const }];
  expect(updateBrowseSearch(previous, { colors }).colors).toEqual(colors);
});

it('normalizes profile search without changing internal spaces', () => {
  expect(normalizeProfileSearch('  @Ada Byron  ')).toBe('ada byron');
  expect(normalizeProfileSearch(' @ ')).toBe('');
});

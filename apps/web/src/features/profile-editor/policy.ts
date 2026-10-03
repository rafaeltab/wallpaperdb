import { validateProfileMarkdown } from '@wallpaperdb/profile-markdown';
import type { EditableProfile, ProfileField } from './contract';

export function aliasesToSchedule(profile: EditableProfile, value: string): string[] {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (normalized === profile.handle) return [];
  const retained = (profile.aliases ?? []).filter(
    (alias) => !alias.expiresAt && alias.handle !== normalized
  );
  const candidates = [...retained.map((alias) => alias.handle), profile.handle];
  return candidates.slice(0, Math.max(0, candidates.length - (profile.retainedAliasLimit ?? 3)));
}

export function fieldError(
  field: ProfileField,
  value: string,
  profile: EditableProfile,
  displayNameMaxLength: number
) {
  if (field === 'biographyMarkdown') {
    const result = validateProfileMarkdown(value, {
      maxCharacters: profile.biographyMaxLength ?? 5000,
    });
    return result.valid ? undefined : result.errors[0]?.message;
  }
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (!normalized)
    return `${field === 'displayName' ? 'Display name' : 'Profile handle'} must not be blank.`;
  if (field === 'displayName' && [...normalized].length > displayNameMaxLength)
    return `Display name must be at most ${displayNameMaxLength} characters.`;
  return undefined;
}

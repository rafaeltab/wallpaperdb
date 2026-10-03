import type { ColorSort, ColorTargetName } from '@/lib/graphql/types';

export type MatchPreference = 'RELAXED' | 'FAVORITE' | 'STRICT';
export const MATCH_PREFERENCES: readonly MatchPreference[] = ['RELAXED', 'FAVORITE', 'STRICT'];
export const MATCH_LABELS = { RELAXED: 'Relaxed', FAVORITE: 'Balanced', STRICT: 'Strict' };
export type ColorPreference = (
  | { color: string; name?: never }
  | { name: ColorTargetName; color?: never }
) & {
  quality: MatchPreference;
  percent?: number;
};

/** Labels and appearances are presentation only. Gateway owns named-target scoring. */
export const COLOR_TARGETS = [
  { name: 'RED', label: 'Red', appearance: '#EF2020', category: 'Swatches' },
  { name: 'ORANGE', label: 'Orange', appearance: '#F08020', category: 'Swatches' },
  { name: 'YELLOW', label: 'Yellow', appearance: '#EED520', category: 'Swatches' },
  { name: 'GREEN', label: 'Green', appearance: '#209040', category: 'Swatches' },
  { name: 'TEAL', label: 'Teal', appearance: '#008080', category: 'Swatches' },
  { name: 'CYAN', label: 'Cyan', appearance: '#20BFD0', category: 'Swatches' },
  { name: 'BLUE', label: 'Blue', appearance: '#2058DF', category: 'Swatches' },
  { name: 'PURPLE', label: 'Purple', appearance: '#9020BF', category: 'Swatches' },
  { name: 'PINK', label: 'Pink', appearance: '#EF80AE', category: 'Swatches' },
  { name: 'BROWN', label: 'Brown', appearance: '#805030', category: 'Swatches' },
  { name: 'BLACK', label: 'Black', appearance: '#101010', category: 'Swatches' },
  { name: 'GRAY', label: 'Gray', appearance: '#808080', category: 'Swatches' },
  { name: 'WHITE', label: 'White', appearance: '#F0F0F0', category: 'Swatches' },
  {
    name: 'GRAYSCALE',
    label: 'Grayscale',
    appearance: 'linear-gradient(90deg,#333,#ddd)',
    category: 'Features',
  },
  {
    name: 'STRICT_GRAYSCALE',
    label: 'Strict grayscale',
    appearance: 'linear-gradient(90deg,#111,#eee)',
    category: 'Features',
  },
  { name: 'NEAR_NEUTRAL', label: 'Near neutral', appearance: '#B5B0AA', category: 'Features' },
  { name: 'DARK', label: 'Dark', appearance: '#252530', category: 'Features' },
  { name: 'LIGHT', label: 'Light', appearance: '#EEEEEE', category: 'Features' },
  { name: 'BRIGHT', label: 'Bright', appearance: '#F5DB86', category: 'Features' },
  { name: 'VIVID', label: 'Vivid', appearance: '#E35D8C', category: 'Features' },
  { name: 'MUTED', label: 'Muted', appearance: '#A899AE', category: 'Features' },
  {
    name: 'MONOCHROMATIC',
    label: 'Monochromatic',
    appearance: 'linear-gradient(90deg,#39325c,#aaa0dc)',
    category: 'Features',
  },
  {
    name: 'RAINBOW',
    label: 'Rainbow',
    appearance: 'linear-gradient(90deg,#e34f50,#e7ca72,#468c78,#5d80d6,#8f79c7)',
    category: 'Features',
  },
] as const satisfies readonly {
  name: ColorTargetName;
  label: string;
  appearance: string;
  category: string;
}[];

export function colorPreferenceLabel(target: ColorPreference): string {
  return target.color ?? COLOR_TARGETS.find((option) => option.name === target.name)?.label ?? '';
}
export function colorPreferenceAppearance(target: ColorPreference): string {
  return (
    target.color ??
    COLOR_TARGETS.find((option) => option.name === target.name)?.appearance ??
    'var(--muted)'
  );
}
export function colorPreferenceKey(target: ColorPreference): string {
  return target.color ?? target.name;
}
export function isDistributionPreference(target: ColorPreference): boolean {
  return target.name === 'MONOCHROMATIC' || target.name === 'RAINBOW';
}
export function parseColorPreferences(input: unknown): ColorPreference[] | undefined {
  if (!Array.isArray(input) || input.length === 0 || input.length > 10) return undefined;
  const preferences: ColorPreference[] = [];
  const entries: unknown[] = input;
  for (const value of entries) {
    if (typeof value !== 'object' || value === null) return undefined;
    const quality = ('quality' in value ? value.quality : undefined) ?? 'FAVORITE';
    if (quality !== 'RELAXED' && quality !== 'FAVORITE' && quality !== 'STRICT') return undefined;
    const percent = 'percent' in value ? value.percent : undefined;
    const color = 'color' in value ? value.color : undefined;
    const name = 'name' in value ? value.name : undefined;
    if (
      percent !== undefined &&
      (typeof percent !== 'number' ||
        !Number.isInteger(percent) ||
        percent < 0 ||
        percent > 100 ||
        percent % 10 !== 0)
    )
      return undefined;
    if ((color === undefined) === (name === undefined)) return undefined;
    const amount = percent === undefined ? {} : { percent };
    if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) {
      preferences.push({ color: color.toUpperCase(), quality, ...amount });
    } else {
      const option = COLOR_TARGETS.find((option) => option.name === name);
      if (!option) return undefined;
      preferences.push({ name: option.name, quality, ...amount });
    }
  }
  if (new Set(preferences.map(colorPreferenceKey)).size !== preferences.length) return undefined;
  return preferences.reduce((sum, target) => sum + (target.percent ?? 0), 0) <= 100
    ? preferences
    : undefined;
}
export function buildColorSort(preferences: readonly ColorPreference[]): ColorSort | undefined {
  if (preferences.length === 0) return undefined;
  return {
    targets: preferences.map((target) => ({
      ...target,
      mode: target.percent === undefined ? 'VIBE' : 'PROPORTIONS',
    })),
  };
}

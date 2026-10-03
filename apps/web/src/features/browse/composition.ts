import { colorPreferenceKey, parseColorPreferences, type ColorPreference } from './colors';
export function compositionLayout(value: readonly ColorPreference[]) {
  const used = value.reduce((sum, target) => sum + (target.percent ?? 0), 0);
  const unspecified = value.filter((target) => target.percent === undefined).length;
  const zeros = value.filter((target) => target.percent === 0).length;
  const share = unspecified ? Math.max((100 - used) / unspecified, 12) : 0;
  const free = unspecified ? 0 : 100 - used;
  const zeroWidth = Math.min(8, 100 / Math.max(value.length, 1));
  const flexible = value.reduce((sum, target) => sum + (target.percent ?? share), 0) + free;
  const scale = flexible > 0 ? (100 - zeros * zeroWidth) / flexible : 1;
  return {
    weights: value.map((target) =>
      target.percent === 0 ? zeroWidth : (target.percent ?? share) * scale
    ),
    free: free * scale,
    scale,
  };
}
export function moveColorBoundary(
  value: readonly ColorPreference[],
  index: number,
  requested: number
): ColorPreference[] {
  const target = value[index];
  if (target?.percent === undefined) return [...value];
  const nextIndex = value.findIndex((target, i) => i > index && target.percent !== undefined);
  const next = nextIndex < 0 ? undefined : value[nextIndex];
  const used = value.reduce((sum, target) => sum + (target.percent ?? 0), 0);
  const pair = target.percent + (next?.percent ?? 0);
  const amount = Math.max(0, Math.min(pair + 100 - used, Math.round(requested / 10) * 10));
  return value.map((target, i) =>
    i === index
      ? { ...target, percent: amount }
      : i === nextIndex
        ? { ...target, percent: Math.max(0, pair - amount) }
        : target
  );
}

export function colorBoundaryMaximum(value: readonly ColorPreference[], index: number): number {
  const target = value[index];
  const next = value.find((target, i) => i > index && target.percent !== undefined);
  return (
    (target?.percent ?? 0) +
    (next?.percent ?? 0) +
    100 -
    value.reduce((sum, target) => sum + (target.percent ?? 0), 0)
  );
}
export function setColorPercentage(
  value: ColorPreference,
  percent: number | undefined,
  maximum: number
): ColorPreference {
  const { percent: previous, ...rest } = value;
  void previous;
  return percent === undefined
    ? rest
    : { ...rest, percent: Math.max(0, Math.min(maximum, Math.round(percent / 10) * 10)) };
}
export function colorEditLimits(
  value: readonly ColorPreference[],
  index: number | 'new',
  draft: ColorPreference
) {
  return {
    maximum:
      100 - value.reduce((sum, target, i) => sum + (i === index ? 0 : (target.percent ?? 0)), 0),
    duplicate: value.some(
      (target, i) => i !== index && colorPreferenceKey(target) === colorPreferenceKey(draft)
    ),
  };
}
export function saveColorPreference(
  value: readonly ColorPreference[],
  index: number | 'new',
  draft: ColorPreference
): ColorPreference[] | undefined {
  if (index !== 'new' && !value[index]) return undefined;
  return parseColorPreferences(
    index === 'new' ? [...value, draft] : value.map((target, i) => (i === index ? draft : target))
  );
}

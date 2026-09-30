import { COLOR_ANCHORS, COLOR_FEATURE_NAMES } from './color-definition.js';
import { colorUtilityKey } from './color-utilities.js';
import type { ColorQuery, ColorRanking, InvalidSearch } from './contract.js';

const namedSwatches: Readonly<Record<string, string>> = {
  red: '#ef2020',
  orange: '#f08020',
  yellow: '#eed520',
  green: '#209040',
  teal: '#008080',
  cyan: '#20bfd0',
  blue: '#2058df',
  purple: '#9020bf',
  pink: '#ef80ae',
  brown: '#805030',
  black: '#101010',
  gray: '#808080',
  white: '#f0f0f0',
};
function hexToLab(hex: string): number[] {
  const [r, g, b] = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
const anchors = COLOR_ANCHORS.map((anchor) => ({ ...anchor, lab: hexToLab(anchor.hex) }));
function nearestAnchor(hex: string): string {
  const lab = hexToLab(hex);
  let nearest = anchors[0],
    minimum = Infinity;
  for (const anchor of anchors) {
    const distance = lab.reduce((sum, value, index) => sum + (value - anchor.lab[index]) ** 2, 0);
    if (distance < minimum) {
      minimum = distance;
      nearest = anchor;
    }
  }
  return `r${String(nearest.index).padStart(4, '0')}`;
}
export function resolveColorRanking(query: ColorQuery): ColorRanking | InvalidSearch {
  const reject = (reason: string): InvalidSearch => ({ _tag: 'InvalidSearch', reason });
  const mode = query.mode ?? 'vibe',
    quality = query.quality ?? 'favorite';
  if (mode !== 'vibe' && mode !== 'proportions') return reject('Unknown color query mode');
  if (!['relaxed', 'favorite', 'strict'].includes(quality)) return reject('Unknown color quality');
  if (query.targets.length < 1 || query.targets.length > 10)
    return reject('Color search accepts one through ten targets');
  const groups = new Map<string, number>();
  for (const target of query.targets) {
    if ((target.color === undefined) === (target.name === undefined))
      return reject('Each target requires exactly one color or name');
    if (target.color !== undefined && !/^#[0-9a-f]{6}$/i.test(target.color))
      return reject('Color must be a six-digit sRGB hex');
    if (target.name !== undefined && !COLOR_FEATURE_NAMES.some((name) => name === target.name))
      return reject('Unknown named color target');
    if (
      mode === 'proportions' &&
      (!Number.isInteger(target.percent) ||
        target.percent === undefined ||
        target.percent < 0 ||
        target.percent > 100 ||
        target.percent % 10 !== 0)
    )
      return reject(
        'Proportions require whole-image percentages from 0 through 100 in steps of ten'
      );
    if (mode === 'vibe' && target.percent !== undefined)
      return reject('Vibe targets do not take percentages');
    const hex =
      target.color ?? (target.name === undefined ? undefined : namedSwatches[target.name]);
    const resolved = hex === undefined ? `n_${target.name}` : nearestAnchor(hex);
    const key = colorUtilityKey(resolved, target.percent, quality);
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return {
    targetCount: query.targets.length,
    utilities: [...groups].map(([key, multiplicity]) => ({ key, multiplicity })),
  };
}

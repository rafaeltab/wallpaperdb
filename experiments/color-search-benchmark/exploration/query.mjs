// Query compilation only. No document filtering or ranking happens here.
import { NAMED_COLORS, FEATURE_NAMES, featureMembership, rgbToLab, rgbToHsv } from './corpus-colors.mjs';

const clamp = x => Math.max(0, Math.min(1, x));
const hexPattern = /^#[0-9a-f]{6}$/i;
const hexRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
const aliases = { 'almost grayscale': 'near_neutral', 'strict grayscale': 'strict_grayscale', 'bright, vivid colors': 'vivid', 'one hue overall': 'monochromatic', 'rainbow-like colors': 'rainbow' };
const failure = reason => ({ supported: false, reason, warnings: [] });
const unit = x => Number.isFinite(x) && x >= 0 && x <= 1;
export const QUERY_BEHAVIOR_VERSION = 'color-intent-v2-structured-accents';

function target(input, mode) {
  const allowed = new Set(['name', 'colorName', 'color', 'colorHex', 'percent', 'targetImagePercent', 'amount', 'edgeWeight', 'space', 'tolerance', 'ranges', 'distance']);
  const unknown = Object.keys(input).filter(k => !allowed.has(k));
  if (unknown.length) throw new Error(`Unsupported target fields: ${unknown.join(', ')}`);
  const name = (input.name ?? input.colorName)?.toLowerCase().replaceAll(' ', '_');
  const color = input.color ?? input.colorHex ?? NAMED_COLORS[name];
  if (!name && !hexPattern.test(color ?? '')) throw new Error('Each target requires a known named color or six-digit hex.');
  if (name && !FEATURE_NAMES.includes(name)) throw new Error(`Unknown color family: ${name}`);
  if (color != null && !hexPattern.test(color)) throw new Error('Colors must be six-digit sRGB hex strings.');
  const percent = input.percent ?? input.targetImagePercent ?? (input.amount == null ? undefined : input.amount * 100);
  if (mode === 'proportions' && (!Number.isFinite(percent) || percent < 0 || percent > 100)) throw new Error('Target percentages must be between 0 and 100.');
  const edgeWeight = input.edgeWeight ?? 0.5;
  if (!unit(edgeWeight)) throw new Error('Edge weight must be between 0 and 1.');
  const space = input.space ?? (input.ranges ? undefined : 'oklab');
  const tolerance = input.tolerance ?? (name ? null : { distance: input.distance ?? 0.12 });
  let ranges = input.ranges ?? (tolerance ? [{ space, ...tolerance }] : []);
  if (!Array.isArray(ranges) || ranges.length > 4) throw new Error('Use at most four range constraints.');
  ranges = ranges.map(range => {
    const keys = { oklab: ['distance'], rgb: ['r', 'g', 'b'], hsv: ['h', 's', 'v'], hsl: ['h', 's', 'l'] }[range.space];
    if (!keys) throw new Error('Range space must be oklab, rgb, hsv, or hsl.');
    if (!keys.every(k => unit(range[k]))) throw new Error('Every range channel must be between 0 and 1.');
    return Object.fromEntries([['space', range.space], ...keys.map(k => [k, range[k]])]);
  });
  if (ranges.length && !color) throw new Error('Custom ranges require a hex anchor.');
  const rgb = color ? hexRgb(color) : null;
  return { name, color, amount: mode === 'proportions' ? percent / 100 : 1, edgeWeight, ranges, explicitRanges: input.tolerance != null || input.ranges != null || input.distance != null, rgb, lab: rgb ? rgbToLab(rgb) : null };
}

/** Accept UI structured requests and the feedback loop's label-free intent schema. */
export function interpretQuery(input = {}) {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return failure('Query must be an object.');
    const allowed = new Set(['mode', 'targets', 'text', 'detail', 'colorTargets', 'swatchHex', 'unspecifiedRemainderPercent', 'colors', 'colorSpace', 'subjectRequest', 'subjectConstraint', 'subject', 'overlap']);
    const unknown = Object.keys(input).filter(k => !allowed.has(k));
    if (unknown.length) return failure(`Unsupported query fields: ${unknown.join(', ')}`);
    if (input.colorSpace && input.colorSpace.toLowerCase() !== 'srgb') return failure('Picked hex colors use sRGB.');
    let mode = input.mode ?? (input.colorTargets?.length || input.colors?.length ? 'proportions' : 'vibe');
    if (!['vibe', 'proportions'].includes(mode)) return failure('Mode must be vibe or proportions.');
    const subject = input.subject ?? input.subjectRequest ?? input.subjectConstraint;
    const text = String(input.text ?? '').trim().toLowerCase();
    let special = null;
    let targets = input.targets ?? input.colorTargets ?? input.colors;
    if (!targets?.length) {
      if (input.swatchHex) targets = [{ color: input.swatchHex }];
      else if (text.includes('grayscale') && text.includes('red')) { special = 'gray_red_accents'; targets = [{ name: 'grayscale' }, { name: 'red' }]; }
      else if (text.includes('dark') && text.includes('bright')) { special = 'dark_bright_accents'; targets = [{ name: 'dark' }, { name: 'bright' }]; }
      else {
        const name = aliases[text] ?? (subject && text.includes('red') ? 'red' : text.replaceAll(' ', '_'));
        if (!FEATURE_NAMES.includes(name)) return failure(`No explicit color interpretation for: ${input.text ?? '(empty query)'}`);
        targets = [{ name }];
      }
    }
    if (targets.length > 10) return failure('Use at most ten color targets.');
    targets = targets.map(t => target(t, mode));
    // Named two-color vibe controls express the same accent intent as legacy text.
    // Preserve ordinary amount/range queries and canonicalize positions for scripts.
    if (!special && mode === 'vibe' && targets.length === 2 && targets.every(t => t.name && t.ranges.length === 0)) {
      for (const [intent, names] of [['gray_red_accents', ['grayscale', 'red']], ['dark_bright_accents', ['dark', 'bright']]]) {
        if (names.every(name => targets.some(t => t.name === name))) {
          special = intent;
          targets = names.map(name => targets.find(t => t.name === name));
          break;
        }
      }
    }
    const requested = mode === 'proportions' ? targets.reduce((sum, t) => sum + t.amount, 0) : 1;
    if (mode === 'proportions' && requested <= 0) return failure('At least one target percentage must be positive.');
    if (requested > 1 + 1e-9 && input.overlap !== 'marginal') return failure('Portion percentages exceed 100%; use overlap=marginal for overlapping global properties.');
    const remainder = mode === 'proportions' ? Math.max(0, 1 - requested) : 0;
    if (input.unspecifiedRemainderPercent != null && Math.abs(input.unspecifiedRemainderPercent / 100 - remainder) > 1e-7) return failure('Remainder must agree with the target percentages.');
    const customRanges = targets.some(t => t.ranges.length > 0);
    return { supported: true, mode, targets, requested, remainder, subject, special, customRanges, explicitRanges: targets.some(t => t.explicitRanges), overlap: input.overlap ?? 'marginal', warnings: [] };
  } catch (error) { return failure(error.message); }
}

function channels(rgb) {
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const l = (max + min) / 2;
  const h = delta < 1e-8 ? null : (((max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) / 6) % 1 + 1) % 1;
  return { rgb: { r, g, b }, hsv: { h, s: max ? delta / max : 0, v: max }, hsl: { h, s: delta < 1e-8 ? 0 : delta / (1 - Math.abs(2 * l - 1)), l } };
}

/** Independent membership (area) and conditional quality: edge colors never count as half the area. */
export function membership(rgb, t) {
  if (t.name && !t.ranges.length) {
    const m = featureMembership(rgb)[t.name];
    return m ?? { area: 0, quality: 0 };
  }
  const ranges = t.ranges.length ? t.ranges : [{ space: 'oklab', distance: 0.12 }];
  let normalizedDistance = 0;
  const actual = channels(rgb), anchor = channels(t.rgb);
  for (const range of ranges) {
    if (range.space === 'oklab') {
      const lab = rgbToLab(rgb);
      const distance = Math.hypot(...lab.map((v, i) => v - t.lab[i]));
      normalizedDistance = Math.max(normalizedDistance, range.distance ? distance / range.distance : distance < 1e-8 ? 0 : Infinity);
    } else {
      for (const key of { rgb: ['r', 'g', 'b'], hsv: ['h', 's', 'v'], hsl: ['h', 's', 'l'] }[range.space]) {
        let distance;
        if (key === 'h') {
          if (range.h === 1) continue;
          if (anchor[range.space].h == null) throw new Error('Achromatic anchors require hue distance 100%.');
          if (actual[range.space].h == null) distance = 1;
          else { const raw = Math.abs(actual[range.space].h - anchor[range.space].h); distance = Math.min(raw, 1 - raw) * 2; }
        } else distance = Math.abs(actual[range.space][key] - anchor[range.space][key]);
        normalizedDistance = Math.max(normalizedDistance, range[key] ? distance / range[key] : distance < 1e-8 ? 0 : Infinity);
      }
    }
  }
  return normalizedDistance <= 1 + 1e-9 ? { area: 1, quality: 1 - (1 - t.edgeWeight) * clamp(normalizedDistance) } : { area: 0, quality: 0 };
}

export function targetCellWeights(compiled, centers) {
  return compiled.targets.map(t => {
    const entries = centers.map(rgb => membership(rgb, t));
    return { area: entries.map(m => m.area), quality: entries.map(m => m.area * m.quality) };
  });
}

export function metadataFilter({ eligibleIds, excludedIds, filter, compiled }) {
  const filters = filter ? (Array.isArray(filter) ? [...filter] : [filter]) : [];
  const mustNot = [];
  if (eligibleIds) filters.push({ ids: { values: eligibleIds } });
  if (excludedIds?.length) mustNot.push({ ids: { values: excludedIds } });
  if (compiled?.subject && !eligibleIds) filters.push({ term: { tags: String(compiled.subject).toLowerCase() } });
  return filters.length || mustNot.length ? { bool: { filter: filters, must_not: mustNot } } : { match_all: {} };
}

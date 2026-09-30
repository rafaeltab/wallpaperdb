import {
  COLOR_ANCHORS,
  COLOR_CUTOFFS,
  COLOR_FEATURE_NAMES,
} from '@wallpaperdb/events/color-vocabulary';
import type { ColorDescriptor, ColorQuality } from './contract.js';

export const COLOR_UTILITY_VERSION = 'linked-3-linear-10-v1';
export const COLOR_QUALITY_PRESETS = {
  relaxed: { influence: 0, weighting: 0 },
  favorite: { influence: 0.5, weighting: 1 },
  strict: { influence: 1, weighting: 3 },
} as const;

export function colorUtilityKey(
  target: string,
  percent: number | undefined,
  quality: ColorQuality
): string {
  const preset = COLOR_QUALITY_PRESETS[quality];
  const profile = percent === undefined ? 'v' : `p${String(percent).padStart(3, '0')}`;
  return `${target}_${profile}_q${String(preset.influence * 100).padStart(3, '0')}_w${preset.weighting}`;
}

const targets = [
  ...COLOR_ANCHORS.map((anchor) => `r${String(anchor.index).padStart(4, '0')}`),
  ...COLOR_FEATURE_NAMES.map((name) => `n_${name}`),
];
const profiles = [undefined, ...Array.from({ length: 11 }, (_, index) => index * 10)];
const qualities: ColorQuality[] = ['relaxed', 'favorite', 'strict'];
export const colorUtilityFields: readonly string[] = Object.freeze(
  targets
    .flatMap((target) =>
      profiles.flatMap((percent) =>
        qualities.map((quality) => colorUtilityKey(target, percent, quality))
      )
    )
    .sort()
);
const weights = Object.fromEntries(
  qualities.map((quality) => {
    const values = COLOR_CUTOFFS.map((cutoff) =>
      Math.exp(COLOR_QUALITY_PRESETS[quality].weighting * (cutoff / 0.9 - 1))
    );
    const sum = values.reduce((total, value) => total + value, 0);
    return [quality, values.map((value) => Math.fround(value / sum))];
  })
);

/** Preserve the frozen encoder's native component rounding before its final utility sum. */
function componentUtility(
  coverage: number,
  quality: number,
  percent: number | undefined,
  influence: number,
  weight: number
): number {
  const vibe = percent === undefined;
  const origin = (percent ?? 0) * 100;
  const scale = coverage <= origin ? 5000 / 0.5 : 5000 / 1.5 / 0.5;
  const area = vibe
    ? Math.sqrt(coverage * Math.fround(0.0001))
    : Math.max(0, (scale - Math.abs(coverage - origin)) / scale);
  let factor = 1;
  const strength = (vibe ? 1 : 0.35) * influence;
  if ((vibe || origin > 0) && strength > 0) {
    if (vibe && strength === 1) factor = Math.fround(quality);
    else {
      const qualityScale = 0.5 / (1 - (1 - strength * 0.5));
      factor = Math.max(0, (qualityScale - Math.abs(1 - Math.fround(quality))) / qualityScale);
    }
  }
  return Math.fround(area * factor * weight);
}

export function encodeColorUtilities(descriptor: ColorDescriptor): Record<string, number> {
  const utilities: Record<string, number> = {};
  for (const quality of qualities) {
    const influence = COLOR_QUALITY_PRESETS[quality].influence;
    for (const percent of profiles) {
      for (let index = 0; index < COLOR_ANCHORS.length; index++) {
        const sum = descriptor.layers.reduce(
          (total, layer, level) =>
            total +
            componentUtility(
              layer.coverage[index],
              layer.quality[index],
              percent,
              influence,
              weights[quality][level]
            ),
          0
        );
        utilities[colorUtilityKey(targets[index], percent, quality)] = Math.fround(
          Math.max(0, Math.min(1, sum))
        );
      }
      for (const name of COLOR_FEATURE_NAMES) {
        const measured = descriptor.named[name];
        utilities[colorUtilityKey(`n_${name}`, percent, quality)] = Math.fround(
          Math.max(
            0,
            Math.min(
              1,
              componentUtility(measured.coverage, measured.quality, percent, influence, 1)
            )
          )
        );
      }
    }
  }
  return utilities;
}

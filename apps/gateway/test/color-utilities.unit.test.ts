import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as colorVocabulary from '@wallpaperdb/events/color-vocabulary';
import {
  COLOR_ANCHORS,
  COLOR_CUTOFFS,
  COLOR_FEATURE_NAMES,
  COLOR_MEASUREMENT_VERSION,
  COLOR_REFERENCE_COMMIT,
  COLOR_ANCHORS_SHA256,
  colorUtilityFields,
  encodeColorUtilities,
} from '../src/capabilities/catalogue/index.js';
import reference from './fixtures/prototype/utilities.json';

describe('Selected color utility encoder', () => {
  it('shares the frozen descriptor vocabulary with extraction through its public contract', () => {
    expect(COLOR_ANCHORS).toBe(colorVocabulary.COLOR_ANCHORS);
    expect(COLOR_CUTOFFS).toBe(colorVocabulary.COLOR_CUTOFFS);
    expect(COLOR_FEATURE_NAMES).toBe(colorVocabulary.COLOR_FEATURE_NAMES);
    expect(COLOR_MEASUREMENT_VERSION).toBe(colorVocabulary.COLOR_MEASUREMENT_VERSION);
    expect(COLOR_REFERENCE_COMMIT).toBe(colorVocabulary.COLOR_REFERENCE_COMMIT);
    expect(COLOR_ANCHORS_SHA256).toBe(colorVocabulary.COLOR_ANCHORS_SHA256);
  });
  it('uses the frozen anchor bank including original IDs and swatches', () => {
    expect(createHash('sha256').update(JSON.stringify(COLOR_ANCHORS)).digest('hex')).toBe(
      reference.anchorSha256
    );
  });
  it.each(reference.cases)('preserves every frozen utility for $name', ({
    descriptor,
    utilities,
  }) => {
    const actual = encodeColorUtilities(descriptor);
    expect(Object.keys(actual).sort()).toEqual(Object.keys(utilities).sort());
    expect(Object.keys(actual)).toHaveLength(10044);
    expect(actual).toEqual(utilities);
    expect(colorUtilityFields).toEqual(Object.keys(utilities).sort());
  });
});

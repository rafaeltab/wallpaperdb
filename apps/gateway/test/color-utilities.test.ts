import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  COLOR_ANCHORS,
  colorUtilityFields,
  encodeColorUtilities,
} from '../src/capabilities/catalogue/index.js';
import reference from './fixtures/prototype/utilities.json';

describe('Selected color utility encoder', () => {
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

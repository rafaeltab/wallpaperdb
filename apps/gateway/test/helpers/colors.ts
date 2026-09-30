import { COLOR_ANCHORS_SHA256, COLOR_REFERENCE_COMMIT } from '@wallpaperdb/events';
import type { ProjectionChange } from '../../src/capabilities/projection/index.js';
import reference from '../fixtures/prototype/utilities.json';

export const colorFixture = reference.cases[0];
export function measuredColors(
  wallpaperId: string,
  occurredAt = '2026-01-01T00:00:00.000Z',
  name = 'red'
): Extract<ProjectionChange, { _tag: 'ColorsMeasured' }> {
  const fixture = reference.cases.find((value) => value.name === name);
  if (!fixture) throw new Error('Unknown color fixture');
  return {
    _tag: 'ColorsMeasured',
    wallpaperId,
    occurrence: {
      source: 'https://wallpaperdb/color-extractor',
      id: `${wallpaperId}-${name}-${occurredAt}`,
      occurredAt,
    },
    descriptor: fixture.descriptor,
    original: { owner: 'ingestor', id: wallpaperId },
    provenance: {
      referenceCommit: COLOR_REFERENCE_COMMIT,
      anchorsSha256: COLOR_ANCHORS_SHA256,
      originalSha256: 'a'.repeat(64),
    },
  };
}

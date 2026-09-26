import { uploadEnvelopeConformance } from '@wallpaperdb/test-utils/event-contracts';
import { expect, it } from 'vitest';
import { translateEvent } from '../src/adapters/events/index.js';
it.each(uploadEnvelopeConformance())('$name', ({ payload, metadata, accepted, expected }) => {
  const translated = translateEvent('wallpaper.uploaded', payload, metadata);
  expect(translated !== undefined).toBe(accepted);
  if (expected) {
    expect(translated?.occurrence).toEqual({ source: expected.source, id: expected.id });
    expect(translated?.correlationId).toBe(expected.correlationId);
    expect(translated?.causationId).toBe(expected.causationId);
    expect(translated?.causationSource).toBe(expected.causationSource);
  }
});

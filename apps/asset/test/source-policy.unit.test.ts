import { describe, expect, it } from 'vitest';
import { parseAuthority } from '../src/authority.js';
import { authorityFixture } from './fixtures/authority.js';

describe('typed Source admission configuration', () => {
  it('requires explicit per-type admission and fingerprints prospective policy edits', () => {
    const raw = authorityFixture();
    const authority = parseAuthority(raw);
    expect(authority.assetTypes.wallpaper).toMatchObject({
      maxActiveSources: 16,
      maxCandidates: 2,
      admission: {
        maxBytes: 52428800,
        maxPixels: 100000000,
        maxAxis: 20000,
        sourceModels: ['sdr-jpeg', 'sdr-png', 'sdr-webp'],
      },
    });
    expect(authority.assetTypes.picture).toMatchObject({
      maxActiveSources: 1,
      admission: { maxBytes: 5242880, squareSize: 512 },
    });
    const changed = structuredClone(raw);
    changed.assetTypes.wallpaper.admission.maxBytes = 1024;
    expect(parseAuthority(changed).identity).not.toBe(authority.identity);
    expect(() => parseAuthority({ ...raw, assetTypes: { wallpaper: {} } })).toThrow();
  });
});

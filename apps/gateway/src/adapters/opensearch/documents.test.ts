import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import type { SearchSelection } from '../../capabilities/catalogue/index.js';
import { wallpaperSearchResponse } from './documents.js';

const index = 'wallpapers';
const id = 'wallpaper-1';
const selection: SearchSelection = {
  color: {
    targetCount: 3,
    utilities: [
      { key: 'first', multiplicity: 2 },
      { key: 'second', multiplicity: 1 },
    ],
  },
  size: 1,
  sortOrder: 'desc',
};

function response(score: number, first = 0.25, second = 0.75) {
  return {
    timed_out: false,
    _shards: { total: 1, successful: 1, failed: 0 },
    hits: {
      total: { value: 1, relation: 'eq' },
      hits: [
        {
          _id: id,
          _index: index,
          _source: {
            wallpaperId: id,
            userId: 'profile-1',
            variants: [],
            uploadedAt: '2026-09-30T00:00:00Z',
            updatedAt: '2026-09-30T00:00:00Z',
          },
          _score: score,
          fields: {
            wallpaperId: [id],
            'utilities.first': [first],
            'utilities.second': [second],
          },
          sort: [score, id],
        },
      ],
    },
  };
}

describe('OpenSearch color ranking response', () => {
  it('accepts a native float score that weights repeated targets', async () => {
    const score = Math.fround((2 * 0.25 + 0.75) / 3);
    const result = await Effect.runPromise(
      wallpaperSearchResponse(selection, index)(response(score))
    );
    expect(result.hits.hits[0]?._score).toBe(score);
  });

  it('rejects a changed score even when the sort cursor changes with it', async () => {
    const changed = response(0.5);
    await expect(
      Effect.runPromise(wallpaperSearchResponse(selection, index)(changed))
    ).rejects.toThrow();
  });

  it('rejects a nonzero score for zero-valued selected utilities', async () => {
    const changed = response(0.01, 0, 0);
    await expect(
      Effect.runPromise(wallpaperSearchResponse(selection, index)(changed))
    ).rejects.toThrow();
  });
});

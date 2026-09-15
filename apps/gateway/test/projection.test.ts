import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  createProjection,
  type ProjectionStore,
  type ProjectionMutation,
} from '../src/projection/index.js';

class ControlledProjection implements ProjectionStore {
  readonly changes: ProjectionMutation[] = [];
  constructor(private readonly available = true) {}
  apply(change: ProjectionMutation) {
    return Effect.sync(() => {
      if (!this.available) return { _tag: 'Unavailable' } as const;
      this.changes.push(change);
      return { _tag: 'Applied' } as const;
    });
  }
}

const occurrence = {
  source: 'wallpaperdb/color-extractor',
  id: 'colors-1',
  occurredAt: '2026-01-01T00:00:00.000Z',
};

describe('Catalogue projection', () => {
  it.each(
    [[], [1], Array(64).fill(0), [-1, ...Array(63).fill(1)]].map((colorHistogram) => ({
      colorHistogram,
    }))
  )('rejects a histogram that cannot represent catalogue color similarity', async ({
    colorHistogram,
  }) => {
    const store = new ControlledProjection();
    const outcome = await Effect.runPromise(
      createProjection(store).record({
        _tag: 'ColorsExtracted',
        occurrence,
        wallpaperId: 'wallpaper',
        colorHistogram,
        colorSpace: 'hsv',
      })
    );
    expect(outcome).toEqual({ _tag: 'Rejected', reason: 'invalid-color-histogram' });
    expect(store.changes).toEqual([]);
  });

  it('preserves occurrence identity and creates a deterministic upload snapshot', async () => {
    const store = new ControlledProjection();
    const outcome = await Effect.runPromise(
      createProjection(store).record({
        _tag: 'WallpaperUploaded',
        occurrence,
        wallpaperId: 'wallpaper',
        profileId: 'profile',
        uploadedAt: occurrence.occurredAt,
      })
    );
    expect(outcome).toEqual({ _tag: 'Completed' });
    expect(store.changes).toEqual([
      {
        _tag: 'PublishWallpaper',
        occurrence,
        wallpaperId: 'wallpaper',
        profileId: 'profile',
        uploadedAt: occurrence.occurredAt,
      },
    ]);
  });

  it('classifies unavailable persistence for broker retry', async () => {
    const outcome = await Effect.runPromise(
      createProjection(new ControlledProjection(false)).record({
        _tag: 'ColorsExtracted',
        occurrence,
        wallpaperId: 'wallpaper',
        colorHistogram: Array(64).fill(1),
        colorSpace: 'hsv',
      })
    );
    expect(outcome).toEqual({ _tag: 'Retry' });
  });
});

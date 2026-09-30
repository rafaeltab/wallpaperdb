import { Effect, Layer } from 'effect';
import type { ProjectionChange, ProjectionMutation, ProjectionOutcome } from './contract.js';
import { compatibleMeasurements } from './measurements.js';
import { ProjectCatalogue, ProjectionStore, type ProjectionUnavailable } from './contract.js';

export const projectionLayer: Layer.Layer<ProjectCatalogue, never, ProjectionStore> = Layer.effect(
  ProjectCatalogue,
  Effect.gen(function* () {
    const store = yield* ProjectionStore;
    const record = Effect.fn('catalogue.project')(function* (
      change: ProjectionChange
    ): Effect.fn.Return<ProjectionOutcome, ProjectionUnavailable> {
      if (change._tag === 'ColorsMeasured' && !compatibleMeasurements(change)) {
        return { _tag: 'Rejected', reason: 'incompatible-color-measurements' };
      }
      const outcome = yield* store.apply(toMutation(change));
      switch (outcome._tag) {
        case 'Applied':
          return { _tag: 'Completed' } satisfies ProjectionOutcome;
        case 'Unchanged':
          return { _tag: 'Ignored' } satisfies ProjectionOutcome;
        case 'Rejected':
          return { _tag: 'Rejected', reason: 'invalid-projection' } satisfies ProjectionOutcome;
      }
    });
    return ProjectCatalogue.of({ record });
  })
);

function toMutation(change: ProjectionChange): ProjectionMutation {
  switch (change._tag) {
    case 'WallpaperUploaded':
      return { ...change, _tag: 'PublishWallpaper' };
    case 'VariantAvailable':
      return { ...change, _tag: 'PublishVariant' };
    case 'ColorsMeasured':
      return { ...change, _tag: 'PublishMeasurements' };
    case 'ProfilePublished':
      return { ...change, _tag: 'PublishProfile' };
  }
}

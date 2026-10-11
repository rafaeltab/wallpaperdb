import { Effect, Layer } from 'effect';
import type { ProjectionChange, ProjectionOutcome } from './contract.js';
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
      const outcome = yield* store.apply(change);
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

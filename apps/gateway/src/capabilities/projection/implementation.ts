import { Effect, Layer, Schema } from 'effect';
import type { ProjectionChange, ProjectionMutation, ProjectionOutcome } from './contract.js';
import { ProjectCatalogue, ProjectionStore, type ProjectionUnavailable } from './contract.js';

const validHistogram = Schema.is(
  Schema.Array(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))).check(
    Schema.isLengthBetween(64, 64),
    Schema.makeFilter((values) => values.some((value) => value > 0))
  )
);

export const projectionLayer: Layer.Layer<ProjectCatalogue, never, ProjectionStore> = Layer.effect(
  ProjectCatalogue,
  Effect.gen(function* () {
    const store = yield* ProjectionStore;
    const record = Effect.fn('catalogue.project')(function* (
      change: ProjectionChange
    ): Effect.fn.Return<ProjectionOutcome, ProjectionUnavailable> {
      // Utility projection is introduced by #306. The complete fact remains in retained NATS history.
      if (change._tag === 'ColorsMeasured') return { _tag: 'Ignored' };
      if (change._tag === 'ColorsExtracted' && !validHistogram(change.colorHistogram)) {
        return { _tag: 'Rejected', reason: 'invalid-color-histogram' } satisfies ProjectionOutcome;
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

function toMutation(
  change: Exclude<ProjectionChange, { readonly _tag: 'ColorsMeasured' }>
): ProjectionMutation {
  switch (change._tag) {
    case 'WallpaperUploaded':
      return { ...change, _tag: 'PublishWallpaper' };
    case 'VariantAvailable':
      return { ...change, _tag: 'PublishVariant' };
    case 'ColorsExtracted':
      return { ...change, _tag: 'PublishColors' };
    case 'ProfilePublished':
      return { ...change, _tag: 'PublishProfile' };
  }
}

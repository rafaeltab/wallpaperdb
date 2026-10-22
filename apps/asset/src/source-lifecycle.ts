import { Effect, Layer } from 'effect';
import { Sources } from './capabilities/sources/index.js';
import { Lifecycle, LifecycleFailure } from './capabilities/lifecycle/index.js';
/** Creation remains generic; owned inspection uses the Source capability's current membership. */
export const lifecycleSourceInspectionLayer = Layer.effect(
  Lifecycle,
  Effect.gen(function* () {
    const lifecycle = yield* Lifecycle;
    const sources = yield* Sources;
    return Lifecycle.of({
      command: lifecycle.command,
      inspect: (owner, assetId) =>
        sources
          .list(owner, assetId)
          .pipe(
            Effect.mapError(
              (cause) => new LifecycleFailure({ operation: 'inspect-sources', cause })
            )
          ),
    });
  })
);

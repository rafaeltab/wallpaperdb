import { Effect, Layer } from 'effect';
import { RecoveryPorts, Restack } from './contract.js';
export const RestackLive = Layer.effect(
  Restack,
  Effect.gen(function* () {
    const ports = yield* RecoveryPorts;
    return {
      advance: () =>
        Effect.gen(function* () {
          const resolution = yield* ports.resolve();
          if (!resolution.classification || !resolution.commit)
            return { ...resolution, ready: false };
          if (resolution.classification === 'COMPLEX' && !(yield* ports.review(resolution.commit)))
            return { ...resolution, progress: 'Awaiting independent review-loop', ready: false };
          const ready = yield* ports.verify(resolution.commit);
          return { ...resolution, progress: ready ? 'Verified' : 'Awaiting CI', ready };
        }),
    };
  })
);

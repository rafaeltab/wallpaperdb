import { Effect, Layer } from 'effect';
import { expect, it } from 'vitest';
import { Restack, RestackLive, RecoveryPorts } from '../src/capabilities/restack/index.js';

it.each(['SIMPLE', 'COMPLEX', undefined] as const)(
  'gates %s conflict resolution on its required verification',
  async (classification) => {
    let reviewed = false;
    let ci = false;
    const calls: string[] = [];
    const ports = {
      resolve: () => Effect.succeed({ classification, commit: 'resolved', progress: 'resolving' }),
      review: () => {
        calls.push('review');
        return Effect.succeed(reviewed);
      },
      verify: () => {
        calls.push('ci');
        return Effect.succeed(ci);
      },
    };
    expect(
      (
        await Effect.runPromise(
          Effect.flatMap(Restack, (restack) => restack.advance()).pipe(
            Effect.provide(RestackLive.pipe(Layer.provide(Layer.succeed(RecoveryPorts, ports))))
          )
        )
      ).ready
    ).toBe(false);
    expect(calls).toEqual(classification ? ['review'] : []);
    reviewed = true;
    calls.length = 0;
    expect(
      (
        await Effect.runPromise(
          Effect.flatMap(Restack, (restack) => restack.advance()).pipe(
            Effect.provide(RestackLive.pipe(Layer.provide(Layer.succeed(RecoveryPorts, ports))))
          )
        )
      ).ready
    ).toBe(false);
    expect(calls).toEqual(classification ? ['review', 'ci'] : []);
    ci = true;
    expect(
      (
        await Effect.runPromise(
          Effect.flatMap(Restack, (restack) => restack.advance()).pipe(
            Effect.provide(RestackLive.pipe(Layer.provide(Layer.succeed(RecoveryPorts, ports))))
          )
        )
      ).ready
    ).toBe(Boolean(classification));
  }
);

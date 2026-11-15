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

it('keeps exhausted recovery inactive without reviewing or verifying obsolete checked code', async () => {
  const ports = {
    resolve: () =>
      Effect.succeed({
        phase: 'manual-recovery' as const,
        active: false,
        commit: 'obsolete-checked-head',
        progress: 'Recovery reconciliation attempt limit reached; manual intervention required',
      }),
    review: () => Effect.die('Manual recovery cannot start another review'),
    verify: () => Effect.die('Manual recovery cannot publish or grant readiness'),
  };
  const result = await Effect.runPromise(
    Effect.flatMap(Restack, (restack) => restack.advance()).pipe(
      Effect.provide(RestackLive.pipe(Layer.provide(Layer.succeed(RecoveryPorts, ports))))
    )
  );
  expect(result).toMatchObject({
    phase: 'manual-recovery',
    active: false,
    ready: false,
    progress: expect.stringContaining('limit reached'),
  });
});

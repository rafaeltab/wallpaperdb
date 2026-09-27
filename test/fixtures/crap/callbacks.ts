import * as Effect from 'effect/Effect';

const wrap = <T>(callback: T): T => callback;

export const uncalled = wrap((value: number) => {
  if (value === 1) return 1;
  if (value === 2) return 2;
  if (value === 3) return 3;
  if (value === 4) return 4;
  if (value === 5) return 5;
  if (value === 6) return 6;
  return 0;
});

export function branchedFactory(value: number) {
  const branched = wrap(() => {
    if (value) return 1;
    return 0;
  });
  return branched;
}

export function branchlessFactory() {
  const branchless = wrap(() => {
    return 42;
  });
  return branchless;
}

export const called = wrap((value: number) => value + 1);
export const sameLine = wrap((value: number) => wrap(() => value ? 1 : 0));

export const constructedEffect = Effect.gen(function* () {
  const value = yield* Effect.succeed(1);
  if (value) return 1;
  return 0;
});

export const calledEffect = Effect.fn('probe')(function* (value: number) {
  yield* Effect.succeed(1);
  if (value) return 1;
  return 0;
});

export let idleEntries = 0;
export const idleGenerator = wrap(function* (value: number) {
  yield ++idleEntries;
  if (value) yield 2;
  return 0;
});

export const partialGenerator = wrap(function* (value: number) {
  yield 1;
  if (value) yield 2;
  return 0;
});

export const completedGenerator = wrap(function* (value: number) {
  yield 1;
  if (value) yield 2;
  return 0;
});

export function namedDecision(value: number) {
  let result = 0;
  if (value) result = 1;
  return result;
}

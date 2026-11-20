import { Effect, Layer } from 'effect';
import { Time, type Unavailable } from '../job/index.js';
import {
  PlanningSource,
  PlanningDiscovery,
  type PlanningDiscoveryFacts,
  type PlanningInput,
} from './contract.js';

export const PlanningDiscoveryLive = Layer.effect(
  PlanningDiscovery,
  Effect.gen(function* () {
    const source = yield* PlanningSource;
    const time = yield* Time;
    let sequence = 0;
    let facts: PlanningDiscoveryFacts = { current: [], outcome: 'unknown' };
    const collect = <A extends PlanningInput | undefined>(work: Effect.Effect<A, Unavailable>) =>
      Effect.gen(function* () {
        const startedAt = yield* time.now();
        const id = `planning-discovery:${++sequence}`;
        facts = { current: [...facts.current, { id, startedAt }], outcome: 'unknown' };
        return yield* work.pipe(
          Effect.tap((input) =>
            Effect.gen(function* () {
              const completedAt = yield* time.now();
              facts = {
                ...facts,
                completedAt,
                outcome:
                  input === undefined
                    ? 'unknown'
                    : input.issues.some((issue) =>
                          issue.metadata
                            ? issue.metadata.open && issue.metadata.candidate
                            : issue.open && issue.labels.includes('ready-for-agent')
                        )
                      ? 'ready-matches'
                      : 'no-ready-matches',
              };
            })
          ),
          Effect.onError(() =>
            Effect.gen(function* () {
              const failedAt = yield* time.now().pipe(Effect.orDie);
              facts = { ...facts, outcome: 'unknown', failedAt };
            })
          ),
          Effect.ensuring(
            Effect.sync(() => {
              facts = { ...facts, current: facts.current.filter((item) => item.id !== id) };
            })
          )
        );
      });
    return {
      read: () => collect(source.read()),
      poll: () => collect(source.poll?.() ?? source.read()),
      prepare: <A>(work: (prepared: Effect.Effect<void>) => Effect.Effect<A, Unavailable>) =>
        Effect.gen(function* () {
          const startedAt = yield* time.now();
          const id = `planning-preparation:${++sequence}`;
          facts = { ...facts, current: [...facts.current, { id, startedAt }] };
          const clear = Effect.sync(() => {
            facts = { ...facts, current: facts.current.filter((item) => item.id !== id) };
          });
          const prepared = Effect.gen(function* () {
            const completedAt = yield* time.now().pipe(Effect.orDie);
            facts = { ...facts, completedAt };
            yield* clear;
          });
          return yield* work(prepared).pipe(
            Effect.onError(() =>
              Effect.gen(function* () {
                if (!facts.current.some((item) => item.id === id)) return;
                const failedAt = yield* time.now().pipe(Effect.orDie);
                facts = { ...facts, outcome: 'unknown', failedAt };
              })
            ),
            Effect.ensuring(clear)
          );
        }),
      snapshot: () => Effect.sync(() => facts),
    };
  })
);

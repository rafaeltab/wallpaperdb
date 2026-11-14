import { Effect, Layer } from 'effect';
import { JobReporting, Time } from '../job/index.js';
import { Reporting } from './contract.js';

export const JobReportingLive = Layer.effect(
  JobReporting,
  Effect.gen(function* () {
    const reporting = yield* Reporting;
    const time = yield* Time;
    return {
      begin: reporting.begin,
      failed: (generation, intent, error) =>
        Effect.gen(function* () {
          yield* reporting.enqueue(generation, [
            { kind: 'failure', key: `job:${intent.id}`, error, at: yield* time.now(), sequence: 1 },
          ]);
        }),
      observed: (generation, value) =>
        Effect.gen(function* () {
          if (value.kind !== 'job') return;
          yield* reporting.enqueue(generation, [
            { kind: 'job', value, at: yield* time.now(), sequence: 1 },
          ]);
        }),
      accepted: (intent, stage, index, commit) =>
        Effect.gen(function* () {
          const generation = yield* reporting.begin();
          const at = yield* time.now();
          yield* reporting.immediate(generation, [
            {
              kind: 'job',
              at,
              sequence: 1,
              value: {
                kind: 'job',
                stageIndex: index,
                intent,
                execution: { kind: 'ambiguous' },
                elapsedMs: Math.max(0, at - intent.createdAt),
                acknowledgement: { stage, index, acceptedAt: at },
                delivery: {
                  stage,
                  commit: commit ?? intent.base,
                  ready: false,
                  landed: false,
                  active: true,
                },
              },
            },
          ]);
        }),
    } satisfies JobReporting;
  })
);

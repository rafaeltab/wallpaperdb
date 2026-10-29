import { Clock, Effect, Layer, Random } from 'effect';
import { Execution, Issues, Job, JobStore, type Start, type Intent } from './contract.js';
export const JobLive = Layer.effect(
  Job,
  Effect.gen(function* () {
    const store = yield* JobStore;
    const issues = yield* Issues;
    const execution = yield* Execution;
    const observe = (intent: Intent) =>
      Effect.gen(function* () {
        const observation = yield* execution.observe(intent);
        const now = yield* Clock.currentTimeMillis;
        return {
          kind: 'job' as const,
          intent,
          execution: observation,
          elapsedMs: Math.max(0, now - intent.createdAt),
        };
      }).pipe(Effect.withSpan('factory.job.observe'));
    return {
      status: () =>
        Effect.gen(function* () {
          const intent = yield* store.read();
          return intent ? yield* observe(intent) : { kind: 'empty' as const };
        }),
      start: (command: Start) =>
        Effect.gen(function* () {
          if (yield* store.read()) return { kind: 'occupied' as const };
          if (!validCommand(command)) return { kind: 'rejected' as const };
          const issue = yield* issues.inspect(command.issue);
          if (!eligible(issue)) return { kind: 'rejected' as const };
          const createdAt = yield* Clock.currentTimeMillis;
          const id = `${createdAt}-${yield* Random.nextInt}-${yield* Random.nextInt}`;
          const intent: Intent = {
            ...command,
            id,
            createdAt,
            issueUrl: issue.url,
            branch: `factory/job-${id}`,
            expectedStage: 'implementation',
          };
          if (!(yield* store.reserve(intent))) return { kind: 'occupied' as const };
          if (yield* store.claimLaunch()) yield* execution.launch(intent);
          return yield* observe(intent);
        }).pipe(Effect.withSpan('factory.job.start')),
    } satisfies Job;
  })
);

function validCommand(command: Start): boolean {
  return (
    Number.isSafeInteger(command.issue) &&
    command.issue > 0 &&
    command.context.length <= 16000 &&
    /^[a-f0-9]{40}$/.test(command.base)
  );
}
function eligible(issue: {
  open: boolean;
  author: string;
  labels: readonly string[];
  blockersReady: boolean;
}): boolean {
  return (
    issue.open &&
    ['rafaeltab', 'zero-two-rafaeltab'].includes(issue.author) &&
    issue.labels.includes('ready-for-agent') &&
    !issue.labels.some((label) => ['future-work', 'spec'].includes(label)) &&
    issue.blockersReady
  );
}

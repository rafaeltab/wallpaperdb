import { Effect } from 'effect';
import { z } from 'zod';
import { type Issues, Unavailable } from '../../capabilities/job/index.js';
import { contextualPromise as githubPromise, runInContext } from './context.js';
import { command } from '../../platform/index.js';
import { type JoinConfiguration, prerequisiteJoin } from './joins.js';
import { prerequisiteReadiness, type VerifiedPrerequisite } from './prerequisites.js';
import { publication } from './publication.js';

const issueSchema = z.object({
  number: z.number().int(),
  state: z.enum(['OPEN', 'CLOSED']),
  author: z.object({ login: z.string() }),
  url: z.string().url(),
  body: z.string(),
  labels: z.array(z.object({ name: z.string() })),
});
const blockersSchema = z.array(
  z.object({ number: z.number().int(), state: z.enum(['open', 'closed']) })
);
/** Verified prerequisites are operator assertions of acceptance/review/CI readiness
 * at a pinned commit. Live PR head and ancestry are checked before using them. */
export function githubIssues(config: {
  project: string;
  base: string;
  joins?: JoinConfiguration;
  prBase?: string;
  prerequisites: readonly VerifiedPrerequisite[];
  readyPrerequisites?: () => Effect.Effect<readonly VerifiedPrerequisite[], Unavailable>;
  admitRecovery?: import('../../capabilities/job/index.js').RecoveryAdmission;
}): Issues {
  const contextualPromise: typeof githubPromise = (options) =>
    githubPromise({ ...options, defaultRecoveryAdmission: config.admitRecovery });
  const gh = (args: string[], signal?: AbortSignal) =>
    command('gh', args, config.project, signal).then((text) =>
      text.trim() ? JSON.parse(text) : null
    );
  const joins = config.joins
    ? prerequisiteJoin(config.project, config.base, config.joins, gh)
    : undefined;
  const inspect = (
    number: number,
    prepare = false,
    candidate?: Parameters<Issues['inspect']>[1],
    admitRecovery?: Parameters<NonNullable<Issues['reconcile']>>[0]
  ) =>
    contextualPromise({
      admitRecovery,
      try: async (signal) => {
        return await inspectIssue(number, prepare, signal, candidate);
      },
      catch: (cause) => new Unavailable({ operation: 'inspect-issue', cause }),
    }).pipe(
      Effect.tapError((error) => Effect.logError(error)),
      Effect.withSpan('factory.github.inspect')
    );
  async function joinContext(numbers: readonly number[], signal: AbortSignal) {
    const dynamic = config.readyPrerequisites
      ? await runInContext(config.readyPrerequisites(), signal)
      : [];
    const pending = await joins?.state(numbers);
    const currentAssertions = [...dynamic, ...config.prerequisites];
    // The join retains the original accepted/reviewed association even after
    // retargeting makes the old owning job's publication observation stale.
    const assertions = retainAssertions(currentAssertions, pending?.operation?.layers ?? []);
    const bound = pending?.operation?.layers.every((layer) =>
      assertions.some((item) => sameBinding(item, layer))
    );
    return { assertions, pending, bound };
  }
  type JoinContext = Awaited<ReturnType<typeof joinContext>>;
  type Readiness = Awaited<ReturnType<typeof prerequisiteReadiness>>;
  async function recover(numbers: readonly number[], context: JoinContext, signal: AbortSignal) {
    const { pending, bound } = context;
    if (pending?.operation && bound && !pending.blocked)
      await joins?.prepare(numbers, null, signal);
  }
  async function prepareFresh(
    numbers: readonly number[],
    readiness: Readiness,
    pending: JoinContext['pending'],
    bound: JoinContext['bound'],
    signal: AbortSignal
  ) {
    if (readiness.joinRequired && joins && (!pending?.operation || bound))
      await joins.prepare(numbers, readiness.join, signal, readiness.joinBoundary);
  }
  function joinRequired(
    readiness: Readiness,
    pending: JoinContext['pending'],
    bound: JoinContext['bound']
  ) {
    if (readiness.blockersReady) return false;
    if (pending?.blocked)
      return z.object({ kind: z.literal('conflict') }).safeParse(pending.blocked).success;
    return readiness.joinRequired || !!(pending?.operation && bound);
  }
  function publicReadiness(
    readiness: Readiness,
    pending: JoinContext['pending'],
    bound: JoinContext['bound']
  ) {
    const { join: _join, joinRequired: _required, joinBoundary: _boundary, ...core } = readiness;
    return {
      ...core,
      ...(joins ? { joinRequired: joinRequired(readiness, pending, bound) } : {}),
      recovery: pending?.recovery
        ? z
            .object({
              progress: z.string(),
              classification: z.enum(['SIMPLE', 'COMPLEX']).optional(),
              threadId: z.string().optional(),
              question: z.string().optional(),
            })
            .parse(pending.recovery)
        : undefined,
      ...(pending?.blocked
        ? {
            blockedReason: `Prerequisite join blocked: ${JSON.stringify({ conflict: pending.blocked, recovery: pending.recovery })}`,
          }
        : {}),
    };
  }
  async function joinReadiness(
    numbers: readonly number[],
    prepare: boolean,
    signal: AbortSignal,
    candidate?: Parameters<Issues['inspect']>[1]
  ) {
    const context = await joinContext(numbers, signal);
    const { assertions, pending, bound } = context;
    if (prepare) await recover(numbers, context, signal);
    const replay = bound ? ((await joins?.evidence(numbers, signal)) ?? []) : [];
    const effective = replayAssertions(assertions, replay);
    const readiness = await prerequisiteReadiness(
      { ...config, prerequisites: effective },
      numbers,
      gh,
      signal,
      candidate
    );
    if (prepare) await prepareFresh(numbers, readiness, pending, bound, signal);
    return publicReadiness(readiness, pending, bound);
  }
  async function inspectIssue(
    number: number,
    prepare: boolean,
    signal: AbortSignal,
    candidate?: Parameters<Issues['inspect']>[1]
  ) {
    const issue = issueSchema.parse(
      await gh(
        [
          'issue',
          'view',
          String(number),
          '--repo',
          'rafaeltab/wallpaperdb',
          '--json',
          'number,state,author,url,body,labels',
        ],
        signal
      )
    );
    if (
      issue.number !== number ||
      issue.url !== `https://github.com/rafaeltab/wallpaperdb/issues/${number}`
    )
      throw new Error('Mismatched issue');
    const native = z
      .array(blockersSchema)
      .parse(
        await gh(
          [
            'api',
            `repos/rafaeltab/wallpaperdb/issues/${number}/dependencies/blocked_by`,
            '--paginate',
            '--slurp',
          ],
          signal
        )
      )
      .flat();
    const numbers = blockerNumbers(native, issue.body);
    const readiness = await joinReadiness(numbers, prepare, signal, candidate);
    return {
      open: issue.state === 'OPEN',
      author: issue.author.login,
      labels: issue.labels.map((label) => label.name),
      url: issue.url,
      blockers: numbers,
      ...readiness,
    };
  }
  return {
    recoveries: () =>
      contextualPromise({
        try: (signal) => joins?.recoveries(signal) ?? Promise.resolve([]),
        catch: (cause) => new Unavailable({ operation: 'read-recoveries', cause }),
      }).pipe(
        Effect.tapError((error) => Effect.logError(error)),
        Effect.withSpan('factory.github.recoveries')
      ),
    reconcile: (admitRecovery) =>
      contextualPromise({
        admitRecovery,
        try: async (signal) => {
          await joins?.reconcile(signal);
          const dynamic = config.readyPrerequisites
            ? await runInContext(config.readyPrerequisites(), signal)
            : [];
          await joins?.maintain(
            [
              ...dynamic,
              ...config.prerequisites.filter(
                (item) => !dynamic.some((current) => current.issue === item.issue)
              ),
            ],
            signal
          );
        },
        catch: (cause) => new Unavailable({ operation: 'reconcile-prerequisite-joins', cause }),
      }).pipe(
        Effect.tapError((error) => Effect.logError(error)),
        Effect.withSpan('factory.github.joins.reconcile')
      ),
    repairReplay: (intent, head, repaired) =>
      contextualPromise({
        try: (signal) =>
          joins?.repair(intent.issue, intent.branch, head, repaired, signal) ??
          Promise.resolve(false),
        catch: (cause) => new Unavailable({ operation: 'repair-replay', cause }),
      }).pipe(
        Effect.tapError((error) => Effect.logError(error)),
        Effect.withSpan('factory.github.replay-repair')
      ),
    pullRequest: (intent) =>
      Effect.gen(function* () {
        const replay = yield* Effect.tryPromise({
          try: (signal) => joins?.replayFor(intent.issue, signal) ?? Promise.resolve(null),
          catch: (cause) => new Unavailable({ operation: 'replay-publication', cause }),
        }).pipe(
          Effect.tapError((error) => Effect.logError(error)),
          Effect.withSpan('factory.github.replay-publication')
        );
        const observed = yield* publication(
          gh,
          replay?.target ?? targetBase(intent.prBase, config.prBase),
          replay ?? undefined
        )(intent);
        const blocked = yield* contextualPromise({
          try: (signal) =>
            observed.kind === 'found'
              ? (joins?.boundaryProblem(intent.issue, intent.branch, observed.commit, signal) ??
                Promise.resolve(false))
              : Promise.resolve(false),
          catch: (cause) => new Unavailable({ operation: 'observe-maintenance-boundary', cause }),
        }).pipe(
          Effect.tapError((error) => Effect.logError(error)),
          Effect.withSpan('factory.github.maintenance-boundary')
        );
        if (blocked && observed.kind === 'found')
          return {
            ...observed,
            ready: false,
            manualRecovery: true,
            lifecycle: 'Verified containing boundary unavailable',
          };
        return replayObservation(replay, observed, intent.branch);
      }),
    inspect: (number, candidate) => inspect(number, false, candidate),
    prepare: (number, admitRecovery) =>
      Effect.asVoid(inspect(number, true, undefined, admitRecovery)),
  };
}

export function blockerNumbers(native: readonly { number: number }[], body: string): number[] {
  const sections =
    body.match(
      /^(?:#{1,6}[ \t]+Blocked by[^\n]*(?:\n(?!#{1,6}[ \t])[^\n]*)*|Blocked by[ \t]*:[^\n]*(?:\n[ \t]*[-*][ \t]+[^\n]*)*)/gim
    ) ?? [];
  const fallback = sections.flatMap((section) =>
    [
      ...section.matchAll(/(?:github\.com\/rafaeltab\/wallpaperdb\/issues\/|(?<![\w/])#)(\d+)/g),
    ].map((match) => Number(match[1]))
  );
  return [...new Set([...native.map((blocker) => blocker.number), ...fallback])];
}

function targetBase(jobBase?: string, configuredBase = 'main') {
  return jobBase ?? configuredBase;
}

function sameBinding(first: VerifiedPrerequisite, second: VerifiedPrerequisite) {
  return first.issue === second.issue && first.pr === second.pr && first.commit === second.commit;
}
function retainAssertions(
  current: readonly VerifiedPrerequisite[],
  recorded: readonly VerifiedPrerequisite[]
) {
  return [
    ...current,
    ...recorded.filter((layer) => !current.some((item) => item.issue === layer.issue)),
  ];
}
function replayAssertions(
  assertions: readonly VerifiedPrerequisite[],
  replay: readonly (VerifiedPrerequisite & { next: string })[]
) {
  return assertions.map((item) => {
    const changed = replay.find(
      (layer) =>
        sameBinding(item, layer) ||
        (layer.issue === item.issue &&
          layer.pr === item.pr &&
          'reviewedCommit' in layer &&
          layer.reviewedCommit === item.commit)
    );
    return changed ? { ...item, commit: changed.next } : item;
  });
}

type Replay = Awaited<ReturnType<ReturnType<typeof prerequisiteJoin>['replayFor']>>;
function replayMatches(
  replay: Replay,
  observed: import('../../capabilities/job/index.js').PullRequestObservation,
  branch: string
) {
  return (
    replay &&
    !replay.ambiguous &&
    observed.kind === 'found' &&
    replay.branch === branch &&
    observed.commit === replay.next &&
    observed.url === replay.url
  );
}
function originalReview(replay: Replay) {
  return replay?.reviewedCommit ?? replay?.commit;
}

function replayObservation(
  replay: Replay,
  observed: import('../../capabilities/job/index.js').PullRequestObservation,
  branch: string
): import('../../capabilities/job/index.js').PullRequestObservation {
  if (!replay || observed.kind !== 'found') return observed;
  if (invalidReplay(replay, observed))
    return {
      ...observed,
      ready: false,
      manualRecovery: true,
      lifecycle: 'Publication needs manual recovery',
      reviewedCommit: originalReview(replay),
      parent: replay.onto,
    };
  if (pendingReplay(replay, observed, branch))
    return {
      ...observed,
      ready: false,
      manualRecovery: false,
      maintenancePending: true,
      reviewedCommit: originalReview(replay),
      previousHead: replay.commit,
      owningHeads: replay.owningHeads,
      parent: replay.onto,
    };
  if (replayMatches(replay, observed, branch))
    return {
      ...observed,
      reviewedCommit: originalReview(replay),
      previousHead: replay.commit,
      owningHeads: replay.owningHeads,
      parent: replay.onto,
    };
  return observed;
}

function invalidReplay(replay: NonNullable<Replay>, observed: { commit: string }) {
  return (
    replay.manual || (!replay.pending && (replay.uncertain || observed.commit !== replay.next))
  );
}

function pendingReplay(
  replay: NonNullable<Replay>,
  observed: import('../../capabilities/job/index.js').PullRequestObservation,
  branch: string
) {
  return (replay.pending || replay.automatic) && replayMatches(replay, observed, branch);
}

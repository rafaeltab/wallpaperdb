import { Effect } from 'effect';
import { z } from 'zod';
import { type Issues, Unavailable } from '../../capabilities/job/index.js';
import { command } from '../../platform/index.js';
import { prerequisiteJoin, type JoinConfiguration } from './joins.js';
import { publication } from './publication.js';
import { prerequisiteReadiness, type VerifiedPrerequisite } from './prerequisites.js';
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
}): Issues {
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
    candidate?: Parameters<Issues['inspect']>[1]
  ) =>
    Effect.tryPromise({
      try: async (signal) => {
        return await inspectIssue(number, prepare, signal, candidate);
      },
      catch: (cause) => new Unavailable({ operation: 'inspect-issue', cause }),
    }).pipe(
      Effect.tapError((error) => Effect.logError(error)),
      Effect.withSpan('factory.github.inspect')
    );
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
    const dynamic = config.readyPrerequisites
      ? await Effect.runPromise(config.readyPrerequisites(), { signal })
      : [];
    const pending = await joins?.state(numbers);
    const currentAssertions = [...dynamic, ...config.prerequisites];
    // The join retains the original accepted/reviewed association even after
    // retargeting makes the old owning job's publication observation stale.
    const assertions = [
      ...currentAssertions,
      ...(pending?.operation?.layers ?? []).filter(
        (layer) => !currentAssertions.some((item) => item.issue === layer.issue)
      ),
    ];
    const bound = pending?.operation?.layers.every((layer) =>
      assertions.some(
        (item) => item.issue === layer.issue && item.pr === layer.pr && item.commit === layer.commit
      )
    );
    if (prepare && pending?.operation && bound && !pending.blocked)
      await joins?.prepare(numbers, null, signal);

    const replay = bound ? ((await joins?.evidence(numbers)) ?? []) : [];
    const effective = assertions.map((item) => {
      const changed = replay.find(
        (layer) =>
          layer.issue === item.issue && layer.commit === item.commit && layer.pr === item.pr
      );
      return changed ? { ...item, commit: changed.next } : item;
    });
    const readiness = await prerequisiteReadiness(
      { ...config, prerequisites: effective, replayed: replay.map((item) => item.next) },
      numbers,
      gh,
      signal,
      candidate
    );
    if (prepare && readiness.joinRequired && joins) {
      await joins.prepare(numbers, readiness.join, signal);
    }
    return {
      open: issue.state === 'OPEN',
      author: issue.author.login,
      labels: issue.labels.map((label) => label.name),
      url: issue.url,
      blockers: numbers,
      ...readiness,
      joinRequired:
        !!joins &&
        !readiness.blockersReady &&
        !pending?.blocked &&
        (readiness.joinRequired || !!(pending?.operation && bound)),
      blockedReason: pending?.blocked
        ? `Prerequisite join blocked: ${JSON.stringify(pending.blocked)}`
        : undefined,
    };
  }
  return {
    pullRequest: (intent) => publication(gh, targetBase(intent.prBase, config.prBase))(intent),
    inspect: (number, candidate) => inspect(number, false, candidate),
    prepare: (number) => Effect.asVoid(inspect(number, true)),
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

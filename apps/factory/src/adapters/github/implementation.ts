import { Effect } from 'effect';
import { z } from 'zod';
import { type Issues, Unavailable } from '../../capabilities/job/index.js';
import { command } from '../../platform/index.js';
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
  prBase?: string;
  prerequisites: readonly VerifiedPrerequisite[];
  readyPrerequisites?: () => Effect.Effect<readonly VerifiedPrerequisite[], Unavailable>;
}): Issues {
  const gh = (args: string[], signal?: AbortSignal) =>
    command('gh', args, config.project, signal).then((text) => JSON.parse(text));
  return {
    pullRequest: (intent) => publication(gh, targetBase(intent.prBase, config.prBase))(intent),
    inspect: (number) =>
      Effect.tryPromise({
        try: async (signal) => {
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
          const readiness = await prerequisiteReadiness(
            { ...config, prerequisites: [...dynamic, ...config.prerequisites] },
            numbers,
            gh,
            signal
          );
          return {
            open: issue.state === 'OPEN',
            author: issue.author.login,
            labels: issue.labels.map((label) => label.name),
            url: issue.url,
            blockers: numbers,
            ...readiness,
          };
        },
        catch: (cause) => new Unavailable({ operation: 'inspect-issue', cause }),
      }).pipe(
        Effect.tapError((error) => Effect.logError(error)),
        Effect.withSpan('factory.github.inspect')
      ),
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

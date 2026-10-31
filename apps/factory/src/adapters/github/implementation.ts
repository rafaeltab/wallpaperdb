import { Effect } from 'effect';
import { z } from 'zod';
import { type Issues, Unavailable } from '../../capabilities/job/index.js';
import { command } from '../../platform/index.js';
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
  prBase?: string;
  prerequisites: readonly { issue: number; pr: number; commit: string }[];
}): Issues {
  const gh = (args: string[], signal?: AbortSignal) =>
    command('gh', args, config.project, signal).then((text) => JSON.parse(text));
  async function verifyBlockers(
    numbers: readonly number[],
    signal?: AbortSignal
  ): Promise<boolean> {
    if (numbers.length > 100) return false;
    let blockersReady = true;
    for (const blocker of numbers) {
      const observation = issueSchema.parse(
        await gh(
          [
            'issue',
            'view',
            String(blocker),
            '--repo',
            'rafaeltab/wallpaperdb',
            '--json',
            'number,state,author,url,body,labels',
          ],
          signal
        )
      );
      if (observation.state === 'CLOSED') continue;
      const verified = config.prerequisites.find((item) => item.issue === blocker);
      if (!verified) {
        blockersReady = false;
        continue;
      }
      const pr = z
        .object({ headRefOid: z.string(), state: z.enum(['OPEN', 'MERGED', 'CLOSED']) })
        .parse(
          await gh(
            [
              'pr',
              'view',
              String(verified.pr),
              '--repo',
              'rafaeltab/wallpaperdb',
              '--json',
              'headRefOid,state',
            ],
            signal
          )
        );
      if (pr.headRefOid !== verified.commit || pr.state === 'CLOSED') {
        blockersReady = false;
        continue;
      }
      await command(
        'git',
        ['merge-base', '--is-ancestor', verified.commit, config.base],
        config.project,
        signal
      );
    }

    return blockersReady;
  }
  return {
    pullRequest: publication(gh, config.prBase ?? 'main'),
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
          const blockersReady = await verifyBlockers(numbers, signal);
          return {
            open: issue.state === 'OPEN',
            author: issue.author.login,
            labels: issue.labels.map((label) => label.name),
            url: issue.url,
            blockersReady,
          };
        },
        catch: (cause) => new Unavailable({ operation: 'inspect-issue', cause }),
      }).pipe(
        Effect.tapError((error) => Effect.logError(error)),
        Effect.withSpan('factory.github.inspect')
      ),
  };
}

function blockerNumbers(native: readonly { number: number }[], body: string): number[] {
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

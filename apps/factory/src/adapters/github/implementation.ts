import { Effect } from 'effect';
import { z } from 'zod';
import { type Issues, Unavailable } from '../../capabilities/job/index.js';
import { command } from '../../platform/index.js';
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
  prerequisites: readonly { issue: number; pr: number; commit: string }[];
}): Issues {
  const gh = (args: string[]) =>
    command('gh', args, config.project).then((text) => JSON.parse(text));
  async function verifyBlockers(numbers: readonly number[]): Promise<boolean> {
    if (numbers.length > 100) return false;
    let blockersReady = true;
    for (const blocker of numbers) {
      const observation = issueSchema.parse(
        await gh([
          'issue',
          'view',
          String(blocker),
          '--repo',
          'rafaeltab/wallpaperdb',
          '--json',
          'number,state,author,url,body,labels',
        ])
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
          await gh([
            'pr',
            'view',
            String(verified.pr),
            '--repo',
            'rafaeltab/wallpaperdb',
            '--json',
            'headRefOid,state',
          ])
        );
      if (pr.headRefOid !== verified.commit || pr.state === 'CLOSED') {
        blockersReady = false;
        continue;
      }
      await command(
        'git',
        ['merge-base', '--is-ancestor', verified.commit, config.base],
        config.project
      );
    }

    return blockersReady;
  }
  return {
    inspect: (number) =>
      Effect.tryPromise({
        try: async () => {
          const issue = issueSchema.parse(
            await gh([
              'issue',
              'view',
              String(number),
              '--repo',
              'rafaeltab/wallpaperdb',
              '--json',
              'number,state,author,url,body,labels',
            ])
          );
          if (
            issue.number !== number ||
            issue.url !== `https://github.com/rafaeltab/wallpaperdb/issues/${number}`
          )
            throw new Error('Mismatched issue');
          const native = z
            .array(blockersSchema)
            .parse(
              await gh([
                'api',
                `repos/rafaeltab/wallpaperdb/issues/${number}/dependencies/blocked_by`,
                '--paginate',
                '--slurp',
              ])
            )
            .flat();
          const numbers = blockerNumbers(native, issue.body);
          const blockersReady = await verifyBlockers(numbers);
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
  const section = body.split(/## Blocked by/i)[1]?.split(/\n## /)[0] ?? '';
  const fallback = [...section.matchAll(/github\.com\/rafaeltab\/wallpaperdb\/issues\/(\d+)/g)].map(
    (match) => Number(match[1])
  );
  return [...new Set([...native.map((blocker) => blocker.number), ...fallback])];
}

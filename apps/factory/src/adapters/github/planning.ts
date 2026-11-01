import { Effect } from 'effect';
import { z } from 'zod';
import { Unavailable, type Job } from '../../capabilities/job/index.js';
import type { PlanningSource, PlanningIssue } from '../../capabilities/plan/index.js';
import { command } from '../../platform/index.js';
import { githubIssues, blockerNumbers } from './implementation.js';
const trusted = (author: string) => ['rafaeltab', 'zero-two-rafaeltab'].includes(author);
const issueSchema = z.object({
  number: z.number().int().positive(),
  url: z.string().url(),
  title: z.string(),
  body: z.string(),
  state: z.enum(['OPEN', 'CLOSED']),
  author: z.object({ login: z.string() }),
  labels: z.array(z.object({ name: z.string() })),
  comments: z.array(
    z.object({ author: z.object({ login: z.string() }).nullable(), body: z.string() })
  ),
});
export function githubPlanning(
  config: Parameters<typeof githubIssues>[0],
  job: Job
): PlanningSource {
  const issues = githubIssues(config);
  const gh = async (args: string[], signal: AbortSignal) =>
    JSON.parse(await command('gh', args, config.project, signal));
  return {
    read: () =>
      Effect.gen(function* () {
        const collected = yield* Effect.tryPromise({
          try: async (signal) => {
            const candidates = z
              .array(z.object({ number: z.number().int().positive() }))
              .parse(
                await gh(
                  [
                    'issue',
                    'list',
                    '--repo',
                    'rafaeltab/wallpaperdb',
                    '--state',
                    'open',
                    '--label',
                    'ready-for-agent',
                    '--limit',
                    '1000',
                    '--json',
                    'number',
                  ],
                  signal
                )
              );
            if (candidates.length >= 1000) throw new Error('Discovery exceeds supported bound');
            const queue = candidates.map((i) => i.number);
            const result: Omit<PlanningIssue, 'blockersReady' | 'prerequisiteEvidence'>[] = [];
            for (const number of queue) {
              if (result.some((i) => i.number === number)) continue;
              if (result.length >= 1000) throw new Error('Context exceeds supported bound');
              const issue = issueSchema.parse(
                await gh(
                  [
                    'issue',
                    'view',
                    String(number),
                    '--repo',
                    'rafaeltab/wallpaperdb',
                    '--json',
                    'number,url,title,body,state,author,labels,comments',
                  ],
                  signal
                )
              );
              if (
                issue.number !== number ||
                issue.url !== `https://github.com/rafaeltab/wallpaperdb/issues/${number}`
              )
                throw new Error('Mismatched issue context');
              const native = z
                .array(z.array(z.object({ number: z.number().int().positive() })))
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
              const parent = z
                .object({
                  data: z.object({
                    repository: z.object({
                      issue: z.object({
                        parent: z.object({ number: z.number().int().positive() }).nullable(),
                      }),
                    }),
                  }),
                })
                .parse(
                  await gh(
                    [
                      'api',
                      'graphql',
                      '-f',
                      `query=query { repository(owner:"rafaeltab",name:"wallpaperdb") { issue(number:${number}) { parent { number } } } }`,
                    ],
                    signal
                  )
                ).data.repository.issue.parent;
              const translated = planningContext(issue, parent, native);
              result.push(translated);
              queue.push(...translated.blockers, ...translated.parents);
            }
            return result;
          },
          catch: (cause) => new Unavailable({ operation: 'planning-discovery', cause }),
        }).pipe(
          Effect.tapError((error) => Effect.logError(error)),
          Effect.withSpan('factory.github.planning')
        );
        const enriched: PlanningIssue[] = [];
        for (const issue of collected) {
          const readiness = yield* issues.inspect(issue.number);
          enriched.push({
            ...issue,
            blockersReady: readiness.blockersReady,
            joinRequired: readiness.joinRequired,
            blockedReason: readiness.blockedReason,
            recovery: readiness.recovery,
            prerequisite: readiness.prerequisite,
            prerequisiteEvidence: JSON.stringify(
              config.prerequisites.filter((p) => issue.blockers.includes(p.issue))
            ),
          });
        }
        return {
          issues: enriched,
          job: yield* job.status(),
          capacity: { concurrency: 1 as const, admission: 1 as const },
        };
      }),
  };
}

function planningContext(
  issue: z.infer<typeof issueSchema>,
  parent: { number: number } | null,
  native: readonly { number: number }[]
) {
  const number = issue.number;
  const parents = [
    ...new Set([
      ...(parent ? [parent.number] : []),
      ...[
        ...issue.body.matchAll(
          /(?:^#{1,6} +Parent[^\n]*\n(?:\s*\n)*|^Parent:\s*)(?:https:\/\/github.com\/rafaeltab\/wallpaperdb\/issues\/|#)(\d+)/gim
        ),
      ].map((m) => Number(m[1])),
    ]),
  ];
  const blockers = blockerNumbers(native, issue.body);
  return {
    number,
    url: issue.url,
    title: issue.title,
    body: issue.body,
    author: issue.author.login,
    open: issue.state === 'OPEN',
    labels: issue.labels.map((l) => l.name),
    comments: issue.comments
      .filter((c) => c.author && trusted(c.author.login))
      .map((c) => ({ author: c.author?.login ?? '', body: c.body })),
    blockers,
    parents,
  };
}

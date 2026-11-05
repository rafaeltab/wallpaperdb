import { Effect } from 'effect';
import { z } from 'zod';
import { Unavailable, type Job } from '../../capabilities/job/index.js';
import type { PlanningSource, PlanningIssue } from '../../capabilities/plan/index.js';
import { observeIssue } from './observations.js';
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
  const gh = async (args: string[], signal?: AbortSignal) =>
    JSON.parse(await command('gh', args, config.project, signal));
  return {
    read: () =>
      Effect.gen(function* () {
        // Cache only this refresh. Freshness validation creates an independent cache.
        const pending = new Map<string, Promise<unknown>>();
        const read = (args: string[], signal?: AbortSignal) => {
          const canonical =
            args[0] === 'issue' && args[1] === 'view'
              ? [...args.slice(0, -1), 'number,url,title,body,state,author,labels,comments']
              : args;
          const key = JSON.stringify(canonical);
          let value = pending.get(key);
          if (!value) {
            value = gh(canonical, signal);
            pending.set(key, value);
          }
          return value;
        };
        const prerequisites = config.readyPrerequisites
          ? yield* Effect.cached(config.readyPrerequisites())
          : undefined;
        const issues = githubIssues(
          { ...config, readyPrerequisites: prerequisites ? () => prerequisites : undefined },
          read
        );
        const collected = yield* Effect.tryPromise({
          try: async (signal) => {
            const candidates = z
              .array(z.object({ number: z.number().int().positive() }))
              .parse(
                await read(
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
            const seen = new Set<number>();
            while (queue.length) {
              const batch = [...new Set(queue.splice(0))].filter((n) => !seen.has(n));
              if (seen.size + batch.length > 1000)
                throw new Error('Context exceeds supported bound');
              for (const n of batch) seen.add(n);
              const values = [];
              for (let start = 0; start < batch.length; start += 4)
                values.push(
                  ...(await Promise.all(
                    batch.slice(start, start + 4).map(async (number) => {
                      if (result.length >= 1000) throw new Error('Context exceeds supported bound');
                      const [rawIssue, rawNative, rawParent] = await Promise.all([
                        read(
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
                        ),
                        read(
                          [
                            'api',
                            `repos/rafaeltab/wallpaperdb/issues/${number}/dependencies/blocked_by`,
                            '--paginate',
                            '--slurp',
                          ],
                          signal
                        ),
                        observeIssue(
                          config.project,
                          number,
                          candidates.some((i) => i.number === number),
                          signal,
                          read
                        ),
                      ]);
                      const issue = issueSchema.parse(rawIssue);
                      if (
                        issue.number !== number ||
                        issue.url !== `https://github.com/rafaeltab/wallpaperdb/issues/${number}`
                      )
                        throw new Error('Mismatched issue context');
                      const native = z
                        .array(z.array(z.object({ number: z.number().int().positive() })))
                        .parse(rawNative)
                        .flat();
                      if (issue.comments.length !== rawParent.metadata.commentCount)
                        throw new Error('Incomplete comments');
                      const translated = planningContext(issue, rawParent.metadata.parents, native);
                      return {
                        ...translated,
                        metadata: {
                          ...rawParent.metadata,
                          pullRequests: rawParent.pullRequests.map(({ number, url, state }) => ({
                            number,
                            url,
                            state,
                          })),
                        },
                      };
                    })
                  ))
                );
              result.push(...values);
              for (const translated of values)
                queue.push(...translated.blockers, ...translated.parents);
            }
            return result;
          },
          catch: (cause) => new Unavailable({ operation: 'planning-discovery', cause }),
        }).pipe(
          Effect.tapError((error) => Effect.logError(error)),
          Effect.withSpan('factory.github.planning')
        );
        const enriched: PlanningIssue[] = yield* Effect.forEach(
          collected,
          (issue) =>
            Effect.gen(function* () {
              const readiness = yield* issues.inspect(issue.number);
              return {
                ...issue,
                blockersReady: readiness.blockersReady,
                joinRequired: readiness.joinRequired,
                blockedReason: readiness.blockedReason,
                recovery: readiness.recovery,
                prerequisite: readiness.prerequisite,
                prerequisiteEvidence: JSON.stringify(
                  config.prerequisites.filter((p) => issue.blockers.includes(p.issue))
                ),
              };
            }),
          { concurrency: 4 }
        );
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
  parents: readonly number[],
  native: readonly { number: number }[]
) {
  const number = issue.number;
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

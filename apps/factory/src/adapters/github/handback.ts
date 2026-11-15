import { Effect } from 'effect';
import { z } from 'zod';
import { Unavailable, type Issues } from '../../capabilities/job/index.js';

type Read = (args: string[], signal?: AbortSignal) => Promise<unknown>;
const repo = 'rafaeltab/wallpaperdb';
const issueSchema = z.object({
  number: z.number().int().positive(),
  url: z.string(),
  body: z.string(),
  state: z.enum(['OPEN', 'CLOSED']),
});
export function dependencyHandback(
  gh: Read,
  blockers: (native: readonly { number: number }[], body: string) => number[]
): Pick<Issues, 'validateDependencies' | 'verifyHandback'> {
  const read = async (number: number, signal: AbortSignal) => {
    const issue = issueSchema.parse(
      await gh(
        ['issue', 'view', String(number), '--repo', repo, '--json', 'number,url,body,state'],
        signal
      )
    );
    if (issue.number !== number || issue.url !== `https://github.com/${repo}/issues/${number}`)
      throw new Error('Mismatched dependency issue');
    return issue;
  };
  const edges = async (issue: z.infer<typeof issueSchema>, signal: AbortSignal) => {
    const native = await readNativeBlockers(gh, issue.number, signal);
    return blockers(native, issue.body);
  };
  const effect = <A>(operation: string, work: (signal: AbortSignal) => Promise<A>) =>
    Effect.tryPromise({ try: work, catch: (cause) => new Unavailable({ operation, cause }) }).pipe(
      Effect.tapError((error) => Effect.logError(error)),
      Effect.withSpan(`factory.github.${operation}`)
    );
  return {
    validateDependencies: (intent, dependencies) =>
      effect('validate-dependencies', async (signal) => {
        const visited = new Set<number>();
        const visiting = new Set<number>();
        const visit = async (number: number): Promise<boolean> => {
          if (number === intent.issue || visiting.has(number)) return false;
          if (visited.has(number)) return true;
          if (visited.size + visiting.size >= 1000)
            throw new Error('Dependency graph exceeds verification bound');
          const issue = await read(number, signal);
          visiting.add(number);
          for (const blocker of await edges(issue, signal))
            if (!(await visit(blocker))) return false;
          visiting.delete(number);
          visited.add(number);
          return true;
        };
        try {
          for (const dependency of dependencies)
            if (!(await visit(Number(dependency)))) return 'cycle' as const;
          return 'valid' as const;
        } catch (cause) {
          if (
            cause instanceof Error &&
            /HTTP 404|Could not resolve to an Issue|could not find issue/i.test(cause.message)
          )
            return 'invalid' as const;
          throw cause;
        }
      }),
    verifyHandback: (intent, dependencies) =>
      effect('verify-dependency-handback', async (signal) => {
        const issue = await read(intent.issue, signal);
        if (issue.state !== 'OPEN') return false;
        const recorded = await edges(issue, signal);
        if (!dependencies.every((number) => recorded.includes(Number(number)))) return false;
        const projectEvidence = z
          .object({
            errors: z.array(z.unknown()).max(0).optional(),
            data: z.object({
              repository: z.object({
                issue: z.object({
                  number: z.number().int().positive(),
                  url: z.string(),
                  projectItems: z.object({
                    nodes: z.array(
                      z.object({
                        project: z.object({
                          number: z.number().int().positive(),
                          owner: z.object({ login: z.string() }),
                        }),
                        fieldValueByName: z.object({ name: z.string() }).nullable(),
                      })
                    ),
                    pageInfo: z.object({ hasNextPage: z.literal(false) }),
                  }),
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
                `query=query { repository(owner:"rafaeltab",name:"wallpaperdb") { issue(number:${intent.issue}) { number url projectItems(first:100) { nodes { project { number owner { ... on User { login } ... on Organization { login } } } fieldValueByName(name:"Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } } } pageInfo { hasNextPage } } } } }`,
              ],
              signal
            )
          );
        const projectIssue = projectEvidence.data.repository.issue;
        if (projectIssue.number !== intent.issue || projectIssue.url !== issue.url)
          throw new Error('Mismatched handback project issue');
        const projects = projectIssue.projectItems.nodes.filter(
          (item) => item.project.owner.login === 'rafaeltab' && item.project.number === 7
        );
        if (projects.length !== 1 || projects[0]?.fieldValueByName?.name !== 'Planned')
          return false;
        const prs = z
          .array(
            z.object({
              url: z.string(),
              headRefName: z.string(),
              state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
            })
          )
          .parse(
            await gh(
              [
                'pr',
                'list',
                '--repo',
                repo,
                '--head',
                intent.branch,
                '--state',
                'all',
                '--json',
                'url,headRefName,state',
              ],
              signal
            )
          );
        return prs.every(
          (pr) =>
            /^https:\/\/github.com\/rafaeltab\/wallpaperdb\/pull\/[1-9][0-9]*$/.test(pr.url) &&
            pr.headRefName === intent.branch &&
            pr.state === 'CLOSED'
        );
      }),
  };
}

export async function readNativeBlockers(gh: Read, number: number, signal: AbortSignal) {
  return z
    .array(z.array(z.object({ number: z.number().int().positive() })))
    .parse(await nativeDependencyPages(gh, number, signal))
    .flat();
}
export async function nativeDependencyPages(
  gh: Read,
  number: number,
  signal: AbortSignal
): Promise<unknown> {
  try {
    return await gh(
      ['api', `repos/${repo}/issues/${number}/dependencies/blocked_by`, '--paginate', '--slurp'],
      signal
    );
  } catch (cause) {
    if (!(cause instanceof Error) || !/HTTP (404|410|422)|not supported/i.test(cause.message))
      throw cause;
    return [];
  }
}

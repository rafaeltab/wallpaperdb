import { Effect } from 'effect';
import { z } from 'zod';
import { type Issues, Unavailable } from '../../capabilities/job/index.js';
const schema = z.array(
  z.object({
    url: z.string().url(),
    headRefName: z.string(),
    baseRefName: z.string(),
    headRefOid: z.string().regex(/^[a-f0-9]{40}$/),
    baseRefOid: z.string(),
    state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
    mergeable: z.string(),
    isDraft: z.boolean(),
    statusCheckRollup: z.array(
      z.union([
        z.object({ name: z.string(), status: z.string(), conclusion: z.string().nullable() }),
        z.object({ context: z.string(), state: z.string() }),
      ])
    ),
  })
);
const required = ['Build, Lint, and Test', 'E2E Tests', 'Container E2E Tests'];
export function publication(
  gh: (args: string[], signal?: AbortSignal) => Promise<unknown>,
  base: string
): Issues['pullRequest'] {
  return (intent) =>
    Effect.tryPromise({
      try: async (signal) => {
        const prs = schema.parse(
          await gh(
            [
              'pr',
              'list',
              '--repo',
              'rafaeltab/wallpaperdb',
              '--state',
              'all',
              '--head',
              intent.branch,
              '--base',
              base,
              '--json',
              'url,headRefName,baseRefName,headRefOid,baseRefOid,state,mergeable,isDraft,statusCheckRollup',
            ],
            signal
          )
        );
        if (prs.length === 0) return { kind: 'absent' as const };
        const pr = prs[0];
        if (prs.length !== 1 || !pr || !matches(pr, intent.branch, base, intent.base))
          return { kind: 'ambiguous' as const };
        const checks = pr.statusCheckRollup.map((check) =>
          'name' in check
            ? {
                name: check.name,
                success: check.status === 'COMPLETED' && check.conclusion === 'SUCCESS',
              }
            : { name: check.context, success: check.state === 'SUCCESS' }
        );
        const passed =
          required.every((name) => checks.some((check) => check.name === name && check.success)) &&
          checks
            .filter((check) => check.name.startsWith('codecov/'))
            .every((check) => check.success);
        return {
          kind: 'found' as const,
          url: pr.url,
          commit: pr.headRefOid,
          ready: ready(pr, passed),
          landed: false,
        };
      },
      catch: (cause) => new Unavailable({ operation: 'observe-publication', cause }),
    }).pipe(
      Effect.tapError((error) => Effect.logError(error)),
      Effect.withSpan('factory.github.publication')
    );
}

function matches(pr: z.infer<typeof schema>[number], branch: string, base: string, commit: string) {
  return (
    pr.headRefName === branch &&
    pr.baseRefName === base &&
    pr.baseRefOid === commit &&
    /^https:\/\/github.com\/rafaeltab\/wallpaperdb\/pull\/\d+$/.test(pr.url)
  );
}
function ready(pr: z.infer<typeof schema>[number], passed: boolean) {
  return pr.state === 'OPEN' && !pr.isDraft && pr.mergeable === 'MERGEABLE' && passed;
}

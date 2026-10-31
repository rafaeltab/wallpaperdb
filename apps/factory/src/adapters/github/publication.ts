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
        z.object({
          name: z.string(),
          status: z.string(),
          conclusion: z.string().nullable(),
          detailsUrl: z.string().optional(),
          startedAt: z.string().optional(),
          completedAt: z.string().optional(),
        }),
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
        if (prs.length !== 1 || !pr || !matches(pr, intent.branch, base))
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
          required.every(
            (name) =>
              checks.some((check) => check.name === name) &&
              checks.filter((check) => check.name === name).every((check) => check.success)
          ) &&
          checks
            .filter((check) => check.name.startsWith('codecov/'))
            .every((check) => check.success);
        const progress = await workflowProgress(pr, gh, signal);
        return {
          kind: 'found' as const,
          url: pr.url,
          commit: pr.headRefOid,
          ci: {
            failed:
              pr.state === 'OPEN' &&
              pr.statusCheckRollup.some(
                (check) =>
                  applicable('name' in check ? check.name : check.context) &&
                  ('name' in check
                    ? check.status === 'COMPLETED' &&
                      [
                        'FAILURE',
                        'CANCELLED',
                        'TIMED_OUT',
                        'ACTION_REQUIRED',
                        'STARTUP_FAILURE',
                      ].includes(check.conclusion ?? '')
                    : ['FAILURE', 'ERROR'].includes(check.state))
              ),
            progress,
          },
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

// The pinned stage comparison stays in the intent; an independent target-head
// advance preserves validation when head/target and conflict freedom still match.
function matches(pr: z.infer<typeof schema>[number], branch: string, base: string) {
  return (
    pr.headRefName === branch &&
    pr.baseRefName === base &&
    /^https:\/\/github.com\/rafaeltab\/wallpaperdb\/pull\/\d+$/.test(pr.url)
  );
}
function ready(pr: z.infer<typeof schema>[number], passed: boolean) {
  return pr.state === 'OPEN' && !pr.isDraft && pr.mergeable === 'MERGEABLE' && passed;
}

function applicable(name: string) {
  return required.includes(name) || name.startsWith('codecov/');
}

const jobsSchema = z.object({
  total_count: z.number().int(),
  jobs: z.array(
    z.object({
      id: z.number().int(),
      run_id: z.number().int(),
      head_sha: z.string(),
      status: z.string(),
      conclusion: z.string().nullable(),
      steps: z.array(
        z.object({
          number: z.number().int(),
          status: z.string(),
          conclusion: z.string().nullable(),
          started_at: z.string().nullable(),
          completed_at: z.string().nullable(),
        })
      ),
    })
  ),
});
async function workflowProgress(
  pr: z.infer<typeof schema>[number],
  gh: (args: string[], signal?: AbortSignal) => Promise<unknown>,
  signal: AbortSignal
) {
  const checks = pr.statusCheckRollup.filter((check) =>
    applicable('name' in check ? check.name : check.context)
  );
  const runs = workflowRuns(checks);
  const progress = checks.map((check) => JSON.stringify(check));
  for (const run of runs) {
    const result = jobsSchema.parse(
      await gh(
        ['api', `repos/rafaeltab/wallpaperdb/actions/runs/${run}/jobs?per_page=100&filter=latest`],
        signal
      )
    );
    if (
      result.total_count !== result.jobs.length ||
      result.jobs.some((job) => job.head_sha !== pr.headRefOid || String(job.run_id) !== run)
    )
      throw new Error('Incomplete or stale CI job observation');
    progress.push(JSON.stringify(result.jobs.sort((a, b) => a.id - b.id)));
  }
  return JSON.stringify(progress.sort());
}

function workflowRuns(checks: z.infer<typeof schema>[number]['statusCheckRollup']) {
  const runs = new Set<string>();
  for (const check of checks) {
    if (!('name' in check)) continue;
    const match = check.detailsUrl?.match(
      /^https:\/\/github.com\/rafaeltab\/wallpaperdb\/actions\/runs\/(\d+)\/job\/\d+/
    );
    if (match?.[1]) runs.add(match[1]);
  }
  return runs;
}

import { z } from 'zod';
const sha = z.string().regex(/^[a-f0-9]{40}$/);
type Gh = (args: string[], signal?: AbortSignal) => Promise<unknown>;
/** A merged feature-branch PR is not delivery. GitHub's merge result must be
 * reachable from the repository's authenticated current default branch. */
export async function observeLanding(
  gh: Gh,
  pr: { state: string; url: string; baseRefName: string; headRefOid: string },
  issue: number,
  signal?: AbortSignal
) {
  if (pr.state !== 'MERGED')
    return {
      landed: false,
      ...(pr.state === 'CLOSED'
        ? { lifecycle: 'Closed without merge; manual recovery required' }
        : {}),
    };
  const result = await landingEvidence(gh, pr, signal);
  if (!result) return { landed: false, lifecycle: 'Default-branch landing unverified' };
  const linked = z
    .object({
      state: z.enum(['OPEN', 'CLOSED']),
      projectItems: z.array(
        z.object({ title: z.string(), status: z.object({ name: z.string() }).nullable() })
      ),
    })
    .parse(
      await gh(
        [
          'issue',
          'view',
          String(issue),
          '--repo',
          'rafaeltab/wallpaperdb',
          '--json',
          'state,projectItems',
        ],
        signal
      )
    );
  // GitHub's configured closure and Item closed workflows own the completion
  // transition. Never write Done to compensate for failed automation or regress a
  // later Canary/Released state. Missing automation remains visible and pending.
  return { landed: true, lifecycle: lifecycleStatus(linked) };
}
function lifecycleStatus(linked: {
  state: string;
  projectItems: readonly { title: string; status: { name: string } | null }[];
}) {
  const status = linked.projectItems.find((item) => item.title === 'WallpaperDB')?.status?.name;
  return linked.state === 'CLOSED' && ['Done', 'Canary', 'Released'].includes(status ?? '')
    ? `Linked issue closed; project ${status}`
    : `Landing verified; lifecycle automation pending: issue ${linked.state}, project ${status ?? 'missing'}`;
}
export async function landingEvidence(
  gh: Gh,
  pr: { url: string; baseRefName: string; headRefOid: string },
  signal?: AbortSignal
) {
  const repo = z
    .object({ default_branch: z.string() })
    .parse(await gh(['api', 'repos/rafaeltab/wallpaperdb'], signal));
  if (pr.baseRefName !== repo.default_branch) return null;
  const number = pr.url.split('/').at(-1);
  const merged = z
    .object({
      merged: z.boolean(),
      merge_commit_sha: sha.nullable(),
      head: z.object({ sha }),
      base: z.object({ ref: z.string() }),
    })
    .parse(await gh(['api', `repos/rafaeltab/wallpaperdb/pulls/${number}`], signal));
  if (!mergedAssociation(merged, pr.headRefOid, repo.default_branch) || !merged.merge_commit_sha)
    return null;
  const comparison = z
    .object({ status: z.string(), merge_base_commit: z.object({ sha }) })
    .parse(
      await gh(
        [
          'api',
          `repos/rafaeltab/wallpaperdb/compare/${merged.merge_commit_sha}...${encodeURIComponent(repo.default_branch)}`,
        ],
        signal
      )
    );
  if (
    !['ahead', 'identical'].includes(comparison.status) ||
    comparison.merge_base_commit.sha !== merged.merge_commit_sha
  )
    return null;
  return { commit: merged.merge_commit_sha, branch: repo.default_branch };
}

function mergedAssociation(
  merged: { merged: boolean; head: { sha: string }; base: { ref: string } },
  head: string,
  branch: string
) {
  return merged.merged && merged.head.sha === head && merged.base.ref === branch;
}

import type { Intent } from '../../capabilities/job/index.js';
import { command } from '../../platform/index.js';

/** The remote default branch authenticates an advancement, not the agent's report.
 * A prepared feature boundary cannot be replaced by main while it is unmerged. */
export async function verifiedComparison(
  worktree: string,
  original: Intent,
  expected: Intent,
  reported: string,
  head: string,
  exact: boolean,
  signal?: AbortSignal
): Promise<boolean> {
  if (reported === expected.base) return true;
  if (exact || !/^[a-f0-9]{40}$/.test(reported)) return false;
  if ((original.prBase ?? 'main') !== 'main') return false;
  const git = async (args: string[]) => (await command('git', args, worktree, signal)).trim();
  if (!(await git(['remote'])).split('\n').includes('origin')) return false;
  const main = (await git(['ls-remote', '--heads', 'origin', 'refs/heads/main'])).split(/\s/)[0];
  if (!main || !/^[a-f0-9]{40}$/.test(main)) return false;
  await git(['fetch', '--no-tags', '--no-write-fetch-head', 'origin', main]);
  if ((await git(['merge-base', original.base, reported])) !== original.base) return false;
  if ((await git(['merge-base', expected.base, reported])) !== expected.base) return false;
  if ((await git(['merge-base', reported, main])) !== reported) return false;
  if ((await git(['merge-base', main, head])) !== reported) return false;
  if (await git(['rev-list', '--merges', `${reported}..${head}`])) return false;
  return Boolean(await git(['diff', '--name-only', reported, head]));
}

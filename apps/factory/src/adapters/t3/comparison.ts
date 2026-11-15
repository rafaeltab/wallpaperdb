import type { Intent } from '../../capabilities/job/index.js';
import { command } from '../../platform/index.js';

/** Remote main authenticates advancement. A prepared feature boundary cannot
 * be replaced by main while its required code remains unmerged. */
export async function verifiedComparison(
  worktree: string,
  original: Intent,
  expected: Intent,
  reported: string,
  head: string,
  exact: boolean,
  signal?: AbortSignal
): Promise<boolean> {
  const git = async (args: string[]) => (await command('git', args, worktree, signal)).trim();
  const common = async (left: string, right: string) => {
    try {
      return await git(['merge-base', left, right]);
    } catch (cause) {
      if (cause instanceof Error && 'code' in cause && cause.code === 1) return '';
      throw cause;
    }
  };
  const unchanged = reported === expected.base;
  if (!/^[a-f0-9]{40}$/.test(reported) || (exact && !unchanged)) return false;
  try {
    await git(['cat-file', '-e', `${reported}^{commit}`]);
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 128) return false;
    throw cause;
  }
  if ((await common(reported, head)) !== reported) return false;
  if (exact || (original.prBase ?? 'main') !== 'main') return unchanged;
  if (!(await git(['remote'])).split('\n').includes('origin')) return unchanged;
  const main = (await git(['ls-remote', '--heads', 'origin', 'refs/heads/main'])).split(/\s/)[0];
  if (!main || !/^[a-f0-9]{40}$/.test(main)) return unchanged;
  await git(['fetch', '--no-tags', '--no-write-fetch-head', 'origin', main]);
  if ((await common(original.base, reported)) !== original.base) return false;
  if ((await common(expected.base, reported)) !== expected.base) return false;
  if ((await common(reported, main)) !== reported) return false;
  if ((await common(main, head)) !== reported) return false;
  if (await git(['rev-list', '--merges', `${reported}..${head}`])) return false;
  return unchanged || Boolean(await git(['diff', '--name-only', reported, head]));
}

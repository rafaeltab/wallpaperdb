import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { githubIssues } from '../src/adapters/github/index.js';
import type { Intent } from '../src/capabilities/job/index.js';
const intent: Intent = {
  id: 'job',
  issue: 758,
  issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/758',
  base: 'a'.repeat(40),
  context: '',
  branch: 'factory/job-job',
  createdAt: 1,
  expectedStage: 'implementation',
};
function fixture() {
  let fallback = false;
  let status = 'Planned';
  let prState = 'CLOSED';
  let wrongIssue = false;
  const graph = new Map<number, number[]>([
    [758, [757]],
    [757, []],
  ]);
  const adapter = githubIssues(
    { project: '/unused', base: intent.base, prerequisites: [] },
    async (args) => {
      if (args[0] === 'api') {
        if (fallback) throw new Error('HTTP 404');
        const number = Number(args[1]?.match(/issues\/(\d+)/)?.[1]);
        return [(graph.get(number) ?? []).map((number) => ({ number }))];
      }
      if (args[0] === 'pr')
        return [
          {
            url: 'https://github.com/rafaeltab/wallpaperdb/pull/765',
            headRefName: intent.branch,
            state: prState,
          },
        ];
      const number = Number(args[2]);
      if (!graph.has(number)) throw new Error('Could not resolve to an Issue');
      if (args.at(-1)?.includes('projectItems'))
        return { number, projectItems: [{ title: 'WallpaperDB', status: { name: status } }] };
      return {
        number: wrongIssue ? 1 : number,
        state: 'OPEN',
        url: `https://github.com/rafaeltab/wallpaperdb/issues/${number}`,
        body: fallback
          ? `Blocked by: ${(graph.get(number) ?? []).map((n) => `#${n}`).join(', ')}`
          : '',
      };
    }
  );
  return {
    adapter,
    graph,
    fallback: () => {
      fallback = true;
    },
    status: (value: string) => {
      status = value;
    },
    pr: (value: string) => {
      prState = value;
    },
    wrongIssue: () => {
      wrongIssue = true;
    },
  };
}
it('validates unlabelled prerequisites and rejects nonexistent issues and cycles without writes', async () => {
  const f = fixture();
  if (!f.adapter.validateDependencies) throw new Error('Missing dependency contract');
  expect(await Effect.runPromise(f.adapter.validateDependencies(intent, ['757']))).toBe('valid');
  expect(await Effect.runPromise(f.adapter.validateDependencies(intent, ['999']))).toBe('invalid');
  f.graph.set(757, [758]);
  expect(await Effect.runPromise(f.adapter.validateDependencies(intent, ['757']))).toBe('cycle');
});
it.each([false, true])(
  'verifies native/fallback edges, open issue, owning PR closure and plan status: %s',
  async (fallback) => {
    const f = fixture();
    if (fallback) f.fallback();
    if (!f.adapter.verifyHandback) throw new Error('Missing verification contract');
    expect(await Effect.runPromise(f.adapter.verifyHandback(intent, ['757']))).toBe(true);
    expect(await Effect.runPromise(f.adapter.verifyHandback(intent, ['759']))).toBe(false);
    f.pr('OPEN');
    expect(await Effect.runPromise(f.adapter.verifyHandback(intent, ['757']))).toBe(false);
    f.pr('CLOSED');
    f.status('In Progress');
    expect(await Effect.runPromise(f.adapter.verifyHandback(intent, ['757']))).toBe(false);
    f.status('Planned');
    f.wrongIssue();
    await expect(
      Effect.runPromise(f.adapter.verifyHandback(intent, ['757']))
    ).rejects.toMatchObject({ operation: 'verify-dependency-handback' });
  }
);

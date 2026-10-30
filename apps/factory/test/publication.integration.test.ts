import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { githubIssues } from '../src/adapters/github/index.js';
import type { Intent } from '../src/capabilities/job/index.js';
import { protocol } from './fixtures/setup.js';
it('requires a unique matching PR and mandatory current checks while ignoring advisory failures', async () => {
  const host = await protocol();
  const previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
  process.env.PATH = host.directory + ':' + previous.path;
  process.env.FACTORY_FIXTURE = host.configFile;
  const intent: Intent = {
    id: '1',
    issue: 577,
    issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/577',
    base: host.base,
    context: '',
    branch: 'factory/job-1',
    createdAt: 1,
    expectedStage: 'implementation',
  };
  const adapter = githubIssues({ project: host.repository, base: host.base, prerequisites: [] });
  const checks = ['Build, Lint, and Test', 'E2E Tests', 'Container E2E Tests'].map((name) => ({
    name,
    status: 'COMPLETED',
    conclusion: 'SUCCESS',
  }));
  const pr = {
    url: 'https://github.com/rafaeltab/wallpaperdb/pull/999',
    headRefName: intent.branch,
    baseRefName: 'main',
    headRefOid: host.base,
    baseRefOid: host.base,
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    statusCheckRollup: checks,
  };
  try {
    expect(await Effect.runPromise(adapter.pullRequest(intent))).toEqual({ kind: 'absent' });
    await host.save({ prs: [pr] });
    expect(await Effect.runPromise(adapter.pullRequest(intent))).toMatchObject({
      kind: 'found',
      ready: true,
      landed: false,
    });
    for (const patch of [
      { isDraft: true },
      { state: 'MERGED' },
      { mergeable: 'CONFLICTING' },
      { statusCheckRollup: [] },
      { statusCheckRollup: checks.slice(1) },
      { statusCheckRollup: checks.map((check) => ({ ...check, conclusion: 'FAILURE' })) },
      { statusCheckRollup: [...checks, { context: 'codecov/patch', state: 'FAILURE' }] },
    ]) {
      await host.save({ prs: [{ ...pr, ...patch }] });
      expect(await Effect.runPromise(adapter.pullRequest(intent))).toMatchObject({
        ready: false,
        landed: false,
      });
    }
    await host.save({
      prs: [
        {
          ...pr,
          statusCheckRollup: [
            ...checks,
            { name: 'Advisory mutation pilot', status: 'COMPLETED', conclusion: 'FAILURE' },
          ],
        },
      ],
    });
    expect(await Effect.runPromise(adapter.pullRequest(intent))).toMatchObject({ ready: true });
    for (const prs of [
      [pr, pr],
      [{ ...pr, baseRefOid: 'a'.repeat(40) }],
      [{ ...pr, headRefName: 'wrong' }],
    ]) {
      await host.save({ prs });
      expect(await Effect.runPromise(adapter.pullRequest(intent))).toEqual({ kind: 'ambiguous' });
    }
  } finally {
    process.env.PATH = previous.path;
    if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous.fixture;
    await host.cleanup();
  }
});

import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { t3Planner } from '../src/adapters/t3/index.js';
import { protocol } from './fixtures/setup.js';
it('translates a bound assistant proposal and rejects malformed or user messages', async () => {
  const host = await protocol();
  const previous = process.env.FACTORY_FIXTURE;
  process.env.FACTORY_FIXTURE = host.configFile;
  const proposal = {
    selected: [{ issue: 580, reason: 'Thin end-to-end preview', dependsOn: [], conflicts: [] }],
    deferred: [],
  };
  try {
    const adapter = t3Planner({
      binary: host.binary,
      project: host.repository,
      projectId: 'project-id',
    });
    const input = {
      issues: [
        {
          number: 580,
          url: 'https://github.com/rafaeltab/wallpaperdb/issues/580',
          title: 'Large spec context',
          body: 'x'.repeat(150000),
          author: 'rafaeltab',
          open: true,
          labels: ['ready-for-agent'],
          comments: [],
          blockers: [],
          parents: [],
          blockersReady: true,
          prerequisiteEvidence: '',
        },
      ],
      job: { kind: 'empty' as const },
      capacity: { concurrency: 1 as const, admission: 1 as const },
    };
    await host.save({ planner: { proposal } });
    expect(await Effect.runPromise(adapter.propose(input))).toEqual(proposal);
    for (const patch of [{ role: 'user' }, { malformed: true }, { status: 'failed' }]) {
      await host.save({ planner: { proposal, ...patch } });
      await expect(Effect.runPromise(adapter.propose(input))).rejects.toMatchObject({
        _tag: 'Unavailable',
      });
    }
    await host.save({ planner: { proposal, status: 'running' } });
    const abort = new AbortController();
    const pending = Effect.runPromise(adapter.propose(input), { signal: abort.signal });
    setTimeout(() => abort.abort(), 100);
    await expect(pending).rejects.toBeDefined();
  } finally {
    if (previous === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous;
    await host.cleanup();
  }
});

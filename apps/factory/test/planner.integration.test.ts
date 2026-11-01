import { readFile, writeFile } from 'node:fs/promises';
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
          comments: [{ author: 'rafaeltab', body: 'Preview only; preserve this scope' }],
          blockers: [577],
          parents: [571],
          blockersReady: true,
          prerequisiteEvidence: 'Verified prerequisite commit and independent reviews',
        },
      ],
      job: {
        kind: 'job' as const,
        intent: {
          id: 'parked',
          issue: 579,
          issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/579',
          base: 'a'.repeat(40),
          context: 'Existing implementation scope',
          branch: 'factory/579',
          createdAt: 0,
          expectedStage: 'implementation' as const,
        },
        execution: { kind: 'absent' as const },
        elapsedMs: 100,
        resume: { index: 0, questionId: 'pending-question' },
      },
      capacity: { concurrency: 1 as const, admission: 1 as const },
    };
    await host.save({ planner: { proposal } });
    expect(await Effect.runPromise(adapter.propose(input))).toEqual(proposal);
    expect(JSON.parse(await readFile(`${host.directory}/planner.json`, 'utf8')).input).toEqual(
      input
    );
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

it('returns Unavailable when the planner exits before consuming large context', async () => {
  const host = await protocol();
  try {
    await writeFile(host.binary, '#!/bin/sh\nexit 1\n');
    const adapter = t3Planner({
      binary: host.binary,
      project: host.repository,
      projectId: 'project-id',
    });
    await expect(
      Effect.runPromise(
        adapter.propose({
          issues: [
            {
              number: 580,
              url: 'https://github.com/rafaeltab/wallpaperdb/issues/580',
              title: 'Large context',
              body: 'x'.repeat(150000),
              author: 'rafaeltab',
              open: true,
              labels: ['ready-for-agent'],
              comments: [],
              parents: [],
              blockers: [],
              blockersReady: true,
              prerequisiteEvidence: '',
            },
          ],
          job: { kind: 'empty' },
          capacity: { concurrency: 1, admission: 1 },
        })
      )
    ).rejects.toMatchObject({ _tag: 'Unavailable' });
  } finally {
    await host.cleanup();
  }
});

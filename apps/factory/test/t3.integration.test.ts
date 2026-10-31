import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { t3Execution } from '../src/adapters/t3/index.js';
import type { Intent } from '../src/capabilities/job/index.js';
import { protocol } from './fixtures/setup.js';
it('reconciles a lost launch using real isolated Git binding and rejects contradictory observations', async () => {
  const host = await protocol();
  const previous = process.env.FACTORY_FIXTURE;
  process.env.FACTORY_FIXTURE = host.configFile;
  try {
    const adapter = t3Execution({
      binary: host.binary,
      project: host.repository,
      projectId: 'project-id',
    });
    const intent: Intent = {
      id: 'job-1',
      issue: 576,
      issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/576',
      base: host.base,
      context: 'Read only',
      branch: 'factory/job-1',
      createdAt: 100,
      expectedStage: 'implementation',
    };
    expect(await Effect.runPromise(adapter.observe(intent))).toEqual({ kind: 'absent' });
    expect(await Effect.runPromise(adapter.launch(intent))).toEqual({ kind: 'uncertain' });
    expect(await Effect.runPromise(adapter.observe(intent))).toMatchObject({
      kind: 'found',
      threadId: 'thread-live',
      model: 'gpt-6.1-sol',
      branch: 'factory/job-1',
      worktree: host.directory + '/worker',
    });
    await host.save({ duplicate: true });
    expect(await Effect.runPromise(adapter.observe(intent))).toEqual({ kind: 'ambiguous' });
    for (const overrides of [
      { model: 'wrong' },
      { projectId: 'wrong' },
      { branch: 'wrong' },
      { worktreePath: host.repository },
    ]) {
      await host.save({ overrides });
      expect(await Effect.runPromise(adapter.observe(intent))).toEqual({ kind: 'ambiguous' });
    }
    await host.save({ malformed: true });
    await expect(Effect.runPromise(adapter.observe(intent))).rejects.toMatchObject({
      _tag: 'Unavailable',
    });
  } finally {
    if (previous === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous;
    await host.cleanup();
  }
});

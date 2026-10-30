import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { t3Execution } from '../src/adapters/t3/index.js';
import type { Intent, StageRequest } from '../src/capabilities/job/index.js';
import { protocol } from './fixtures/setup.js';
it('accepts only a structured outcome of the expected completed run at the clean current commit', async () => {
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
      id: '1',
      issue: 577,
      issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/577',
      base: host.base,
      context: '',
      branch: 'factory/job-1',
      createdAt: 1,
      expectedStage: 'implementation',
    };
    await Effect.runPromise(adapter.launch(intent));
    const request: StageRequest = {
      index: 0,
      stage: 'implementation',
      threadId: 'thread-live',
      commit: host.base,
      previousRunId: null,
    };
    expect(await Effect.runPromise(adapter.inspectStage(intent, request))).toBeNull();
    const receipt = {
      jobId: '1',
      stage: 'implementation',
      base: host.base,
      commit: host.base,
      outcome: '<TASK>COMPLETE</TASK>',
      tests: true,
      coverage: true,
      crap: true,
      reviews: false,
    };
    const valid = { role: 'assistant', runId: 'run-1', text: JSON.stringify(receipt) };
    const finished = { latestRunId: 'run-1', runCount: 1, status: 'completed' };
    await host.save({ overrides: finished, messages: [valid] });
    expect(await Effect.runPromise(adapter.inspectStage(intent, request))).toMatchObject({
      accepted: true,
      commit: host.base,
      runId: 'run-1',
      ordinal: 1,
    });
    for (const message of [
      { ...valid, role: 'user' },
      { ...valid, runId: 'old' },
      { ...valid, text: '> ' + valid.text },
      { ...valid, text: '<TASK>COMPLETE</TASK>' },
      { ...valid, text: JSON.stringify({ ...receipt, tests: false }) },
      { ...valid, text: JSON.stringify({ ...receipt, base: 'a'.repeat(40) }) },
    ]) {
      await host.save({ overrides: finished, messages: [message] });
      expect(await Effect.runPromise(adapter.inspectStage(intent, request))).toBeNull();
    }
    await host.save({ overrides: { ...finished, runCount: 2 }, messages: [valid] });
    expect(await Effect.runPromise(adapter.inspectStage(intent, request))).toBeNull();
  } finally {
    if (previous === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous;
    await host.cleanup();
  }
});

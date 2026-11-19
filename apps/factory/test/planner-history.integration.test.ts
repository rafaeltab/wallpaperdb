import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { plannerState } from '../src/adapters/t3/index.js';
import { initializeState, publisher, readRecord } from '../src/platform/index.js';

it('reads concurrent appended claims through warm readers, preserves historical lookup and rejects stale writers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factory-planner-history-'));
  try {
    initializeState(root);
    const path = join(root, 'planner');
    const reader = plannerState(path);
    const writer = plannerState(path);
    expect(await reader.read()).toBeUndefined();
    const first = {
      revision: 0,
      requestId: 'first-request',
      input: 'first context',
      deadline: 1000,
    };
    await writer.save(first);
    expect(await reader.read()).toEqual(first);
    const bound = {
      ...first,
      revision: 1,
      run: { threadId: 'existing-owner', runId: 'existing-run' },
    };
    await writer.save(bound);
    const next = {
      ...first,
      revision: 2,
      requestId: 'second-request',
      phase: 'uncertain' as const,
    };
    await writer.save(next);
    expect(
      await Promise.all([reader.read(first.requestId), reader.read(next.requestId), reader.read()])
    ).toEqual([bound, next, next]);
    const returned = await reader.read(first.requestId);
    if (!returned?.run) throw new Error('Missing retained owner');
    returned.input = 'caller change';
    returned.run.threadId = 'caller change';
    expect(await reader.read(first.requestId)).toEqual(bound);
    expect(await plannerState(path).read(first.requestId)).toEqual(bound);
    expect(await reader.read('unknown-request')).toBeUndefined();
    await expect(reader.save({ ...next, requestId: 'stale-writer' })).rejects.toThrow(
      'changed concurrently'
    );
    expect(await reader.read()).toEqual(next);
    expect(await readRecord(path, 'planner-0.json')).toEqual(first);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('continues rejecting an invalid appended revision after concurrent or repeated reads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factory-planner-invalid-'));
  try {
    initializeState(root);
    const path = join(root, 'planner');
    const journal = plannerState(path);
    const first = { revision: 0, requestId: 'retained-request', input: '{}', deadline: 1000 };
    await journal.save(first);
    expect(await journal.read()).toEqual(first);
    await publisher(path)('planner-1.json', { ...first, revision: 1, input: 42 });
    const attempts = await Promise.allSettled([journal.read(), journal.read(first.requestId)]);
    expect(attempts.every((result) => result.status === 'rejected')).toBe(true);
    await expect(journal.read()).rejects.toBeDefined();
    expect(await readRecord(path, 'planner-0.json')).toEqual(first);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

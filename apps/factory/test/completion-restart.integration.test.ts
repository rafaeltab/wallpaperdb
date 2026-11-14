import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { fileStore } from '../src/adapters/store/index.js';
import { completionFixture } from './fixtures/completion.js';

it('recovers the pending reconciliation once and retains exhaustion across fresh runtimes and stores', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'factory-completion-restart-'));
  let f = await completionFixture(1, fileStore(directory));
  try {
    f.state({ idle: true });
    const pending = await f.status();
    expect(pending).toMatchObject({ reconciliation: { attempts: 1, limit: 1 } });
    expect(f.sends).toHaveLength(0);
    await f.close();
    f = await completionFixture(1, fileStore(directory));
    f.state({ idle: true });
    await f.status();
    expect(f.sends).toHaveLength(1);
    expect(f.sends[0]).toMatchObject({
      stage: 'implementation',
      reconciliation: 'state',
      threadId: 'owner',
    });
    await f.close();
    f = await completionFixture(1, fileStore(directory));
    f.state({ idle: true, run: 2 });
    const exhausted = await f.status();
    expect(exhausted).toMatchObject({
      reconciliation: { attempts: 1, limit: 1 },
      delivery: { active: false, activity: 'manual-recovery' },
    });
    expect(f.sends).toHaveLength(0);
    const control = await Effect.runPromise(fileStore(directory).readControl());
    expect(control.reconciliation?.pending?.index).toBe(1);
    if (exhausted.kind !== 'job' || exhausted.stageIndex === undefined)
      throw new Error('Missing retained job');
    await f.resume({
      jobId: exhausted.intent.id,
      index: exhausted.stageIndex,
      runId: 'run-2',
      revision: control.revision,
      resetReconciliation: true,
    });
    await f.status();
    expect(f.sends).toHaveLength(1);
    expect(
      (await Effect.runPromise(fileStore(directory).readControl())).reconciliation?.attempts
    ).toBe(1);
  } finally {
    await f.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it('retains handback responsibility through restart without resending the instruction', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'factory-handback-restart-'));
  let f = await completionFixture(3, fileStore(directory));
  try {
    f.state({ idle: true, dependencies: ['758'] });
    await f.status();
    await f.status();
    expect(f.sends).toHaveLength(1);
    await f.close();
    f = await completionFixture(3, fileStore(directory));
    f.state({ idle: true, run: 2, dependencies: ['758'], handbackVerified: true });
    expect(await f.status()).toMatchObject({
      delivery: { activity: 'dependency-handback', active: false },
    });
    expect(f.sends).toHaveLength(0);
    expect(await Effect.runPromise(fileStore(directory).read())).toMatchObject({ issue: 757 });
  } finally {
    await f.close();
    await rm(directory, { recursive: true, force: true });
  }
});

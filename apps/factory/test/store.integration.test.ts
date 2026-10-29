import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { fileStore } from '../src/adapters/store/index.js';
import type { Intent } from '../src/capabilities/job/index.js';
it('reserves once across independent instances and retains launch claim after reopen', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'factory-'));
  try {
    expect(await Effect.runPromise(fileStore(directory).read())).toBeNull();
    const a = fileStore(directory),
      b = fileStore(directory);
    const intent: Intent = {
      id: 'job-1',
      issue: 576,
      issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/576',
      base: '4d545298010b8f13883aa6f7cff5d16da808fb91',
      context: 'Read only',
      branch: 'factory/job-1',
      createdAt: 100,
      expectedStage: 'implementation',
    };
    expect(
      (
        await Promise.all([
          Effect.runPromise(a.reserve(intent)),
          Effect.runPromise(b.reserve({ ...intent, id: 'job-2' })),
        ])
      ).sort()
    ).toEqual([false, true]);
    expect(await Effect.runPromise(a.claimLaunch())).toBe(true);
    const reopened = fileStore(directory);
    expect(await Effect.runPromise(reopened.claimLaunch())).toBe(false);
    expect(await Effect.runPromise(reopened.read())).toMatchObject({
      issue: 576,
      expectedStage: 'implementation',
    });
    await writeFile(join(directory, 'intent.json'), '{broken');
    await expect(Effect.runPromise(reopened.read())).rejects.toMatchObject({ _tag: 'Unavailable' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

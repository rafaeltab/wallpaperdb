import { randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Effect } from 'effect';
import { z } from 'zod';
import { type Intent, type JobStore, Unavailable } from '../../capabilities/job/index.js';
const intentSchema = z
  .object({
    id: z.string().min(1),
    issue: z.number().int().positive(),
    issueUrl: z.string().url(),
    base: z.string().regex(/^[a-f0-9]{40}$/),
    context: z.string(),
    branch: z.string(),
    createdAt: z.number().finite(),
    expectedStage: z.literal('implementation'),
  })
  .strict();
const code = (cause: unknown, expected: string) =>
  cause instanceof Error && 'code' in cause && cause.code === expected;
async function syncDirectory(directory: string) {
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
/** Linux local filesystem only. Atomic hard-link publication prevents partial reads
 * and competing reservations; fsync precedes any subsequent external side effect. */
export function fileStore(directory: string): JobStore {
  const effect = <A>(operation: string, work: () => Promise<A>) =>
    Effect.tryPromise({ try: work, catch: (cause) => new Unavailable({ operation, cause }) }).pipe(
      Effect.tapError((error) => Effect.logError(error)),
      Effect.withSpan(`factory.store.${operation}`)
    );
  const publish = async (name: string, value: unknown) => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await syncDirectory(dirname(directory));
    const temporary = join(directory, `.${randomUUID()}`);
    const target = join(directory, name);
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(value));
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temporary, target);
      await syncDirectory(directory);
      return true;
    } catch (cause) {
      if (code(cause, 'EEXIST')) {
        await syncDirectory(directory);
        return false;
      }
      throw cause;
    } finally {
      await unlink(temporary);
    }
  };
  return {
    read: () =>
      effect('read', async () => {
        try {
          return intentSchema.parse(
            JSON.parse(await readFile(join(directory, 'intent.json'), 'utf8'))
          );
        } catch (cause) {
          if (code(cause, 'ENOENT')) return null;
          throw cause;
        }
      }),
    reserve: (intent: Intent) =>
      effect('reserve', () => publish('intent.json', intentSchema.parse(intent))),
    claimLaunch: () => effect('claimLaunch', () => publish('launch-claimed.json', { version: 1 })),
  };
}

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
const stageSchema = z
  .object({
    ordinal: z.number().int().positive().optional(),
    continuation: z.boolean().optional(),
    resume: z.boolean().optional(),
    index: z.number().int().min(0),
    stage: z.enum(['implementation', 'review', 'publication', 'babysitting', 'ci']),
    threadId: z.string().min(1),
    commit: z.string().regex(/^[a-f0-9]{40}$/),
    previousRunId: z.string().min(1).nullable(),
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
  const waitSchema = z
    .object({
      revision: z.number().int().nonnegative(),
      progress: z.string(),
      deadline: z.number().finite(),
      nudged: z.boolean(),
      continuation: stageSchema.optional(),
    })
    .strict();
  const readWait = async () => {
    let latest = null;
    for (let revision = 0; ; revision++) {
      try {
        latest = waitSchema.parse(
          JSON.parse(await readFile(join(directory, `wait-${revision}.json`), 'utf8'))
        );
      } catch (cause) {
        if (code(cause, 'ENOENT')) return latest;
        throw cause;
      }
    }
  };
  const controlSchema = z
    .object({
      revision: z.number().int().nonnegative(),
      cancelled: z.boolean(),
      claimed: z.array(z.number().int().nonnegative()),
      parked: z
        .object({
          index: z.number().int().nonnegative(),
          question: z.object({ id: z.string(), text: z.string() }),
        })
        .optional(),
    })
    .strict();
  const readControl = async () => {
    let latest: import('../../capabilities/job/index.js').Control = {
      revision: -1,
      cancelled: false,
      claimed: [],
    };
    for (let revision = 0; ; revision++) {
      try {
        latest = controlSchema.parse(
          JSON.parse(await readFile(join(directory, `control-${revision}.json`), 'utf8'))
        );
      } catch (cause) {
        if (code(cause, 'ENOENT')) return latest;
        throw cause;
      }
    }
  };
  const saveControl = async (state: import('../../capabilities/job/index.js').Control) => {
    if (state.revision !== (await readControl()).revision + 1) return false;
    return publish(`control-${state.revision}.json`, controlSchema.parse(state));
  };
  return {
    readControl: () => effect('read-control', readControl),
    saveControl: (state) => effect('save-control', () => saveControl(state)),
    readWait: () => effect('read-wait', readWait),
    saveWait: (state) =>
      effect('save-wait', async () => {
        const current = await readWait();
        if (state.revision !== (current?.revision ?? -1) + 1) return false;
        return publish(`wait-${state.revision}.json`, waitSchema.parse(state));
      }),
    bindRun: (request, runId, ordinal = request.ordinal ?? request.index + 1) =>
      effect('bind-run', async () => {
        const initial = request.ordinal ?? request.index + 1;
        const name =
          ordinal === initial
            ? `stage-${request.index}-run.json`
            : `stage-${request.index}-run-${ordinal}.json`;
        await publish(name, { ...stageSchema.parse(request), runId });
        const saved = stageSchema
          .extend({ runId: z.string().min(1) })
          .parse(JSON.parse(await readFile(join(directory, name), 'utf8')));
        return saved.runId === runId;
      }),
    readStage: (index) =>
      effect('read-stage', async () => {
        try {
          return stageSchema.parse(
            JSON.parse(await readFile(join(directory, `stage-${index}.json`), 'utf8'))
          );
        } catch (cause) {
          if (code(cause, 'ENOENT')) return null;
          throw cause;
        }
      }),
    saveStage: (request) =>
      effect('save-stage', () =>
        publish(`stage-${request.index}.json`, stageSchema.parse(request))
      ),
    claimStage: (index) =>
      effect('claim-stage', async () => {
        // Existing pre-question delivery claims remain authoritative.
        try {
          await readFile(join(directory, `stage-${index}-claimed.json`));
          return false;
        } catch (cause) {
          if (!code(cause, 'ENOENT')) throw cause;
        }
        for (;;) {
          const state = await readControl();
          if (state.cancelled || state.claimed.includes(index)) return false;
          if (
            await saveControl({
              ...state,
              revision: state.revision + 1,
              claimed: [...state.claimed, index],
            })
          )
            return true;
        }
      }),
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

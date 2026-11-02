import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { publisher } from '../../platform/index.js';
const schema = z
  .object({
    revision: z.number().int().nonnegative(),
    requestId: z.string().min(1),
    input: z.string(),
    deadline: z.number().finite(),
    run: z.object({ threadId: z.string().min(1), runId: z.string().min(1) }).optional(),
    retired: z.boolean().optional(),
  })
  .strict();
export function plannerState(directory: string) {
  const publish = publisher(directory);
  const read = async () => {
    let latest: z.infer<typeof schema> | undefined;
    for (let revision = 0; ; revision++) {
      try {
        latest = schema.parse(
          JSON.parse(await readFile(join(directory, `planner-${revision}.json`), 'utf8'))
        );
        if (latest.revision !== revision) throw new Error('Invalid planner revision');
      } catch (cause) {
        if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return latest;
        throw cause;
      }
    }
  };
  return {
    read,
    save: async (state: z.infer<typeof schema>) => {
      if (
        state.revision !== ((await read())?.revision ?? -1) + 1 ||
        !(await publish(`planner-${state.revision}.json`, schema.parse(state)))
      )
        throw new Error('Planner state changed concurrently');
      return state;
    },
  };
}

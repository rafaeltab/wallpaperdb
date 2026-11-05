import { z } from 'zod';
import { publisher, requiredRecord } from '../../platform/index.js';
import { plannerSchema as schema } from '../../platform/index.js';
export function plannerState(directory: string) {
  const publish = publisher(directory);
  const read = async () => {
    let latest: z.infer<typeof schema> | undefined;
    for (let revision = 0; ; revision++) {
      try {
        latest = schema.parse(await requiredRecord(directory, `planner-${revision}.json`));
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

import { z } from 'zod';
import { publisher, requiredRecord } from '../../platform/index.js';
import { plannerSchema as schema } from '../../platform/index.js';
export function plannerState(directory: string) {
  const publish = publisher(directory);
  const read = async (requestId?: string) => {
    let latest: z.infer<typeof schema> | undefined;
    for (let revision = 0; ; revision++) {
      try {
        const record = schema.parse(await requiredRecord(directory, `planner-${revision}.json`));
        if (!requestId || record.requestId === requestId) latest = record;
        if (record.revision !== revision) throw new Error('Invalid planner revision');
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

/** Appends evidence. Absence of a thread is never proof of rejection. */
export async function reconcileRejectedPlanner(
  directory: string,
  command: {
    requestId: string;
    revision: number;
    operator: string;
    evidence: string;
    code: -32602;
  }
) {
  const journal = plannerState(directory);
  const current = await journal.read();
  if (
    !current ||
    current.requestId !== command.requestId ||
    current.revision !== command.revision ||
    current.run ||
    current.retired
  )
    throw new Error('Reconciliation requires the exact outstanding unbound request and revision');
  return journal.save({
    ...current,
    revision: current.revision + 1,
    retired: true,
    phase: 'failed',
    detail: 'Operator attests explicit T3 -32602 non-launch validation rejection.',
    reconciliation: {
      operator: command.operator,
      evidence: command.evidence,
      code: command.code,
      at: Date.now(),
    },
  });
}

import type { z } from 'zod';
import { publisher, requiredRecord } from '../../platform/index.js';
import { plannerSchema as schema } from '../../platform/index.js';
export function plannerState(directory: string) {
  const publish = publisher(directory);
  // Published revisions are immutable. Validate each appended revision once per
  // reader lifetime, retaining only indexes, never historical context payloads.
  let revision = 0;
  const requests = new Map<string, number>();
  let pending: Promise<void> | undefined;
  const refresh = async () => {
    for (;;) {
      try {
        const record = schema.parse(await requiredRecord(directory, `planner-${revision}.json`));
        if (record.revision !== revision) throw new Error('Invalid planner revision');
        requests.set(record.requestId, revision);
        revision++;
      } catch (cause) {
        if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return;
        throw cause;
      }
    }
  };
  const read = async (requestId?: string) => {
    pending ??= refresh().finally(() => {
      pending = undefined;
    });
    await pending;
    const selected = requestId ? requests.get(requestId) : revision - 1;
    if (selected === undefined || selected < 0) return undefined;
    const record = schema.parse(await requiredRecord(directory, `planner-${selected}.json`));
    if (record.revision !== selected || (requestId && record.requestId !== requestId))
      throw new Error('Invalid retained planner identity');
    return record;
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

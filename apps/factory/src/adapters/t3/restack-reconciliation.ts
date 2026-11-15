import { z } from 'zod';
import type { Resolution } from '../../capabilities/restack/index.js';
import { responseShape } from './response.js';

export interface RecoveryJournal {
  read(name: string): Promise<unknown | null>;
  write(name: string, value: unknown): Promise<boolean>;
}
const entry = z
  .object({
    index: z.number().int().positive(),
    phase: z.enum(['resolve', 'review']),
    kind: z.enum(['state', 'migration', 'manual']),
    attempts: z.number().int().nonnegative(),
    migrated: z.boolean(),
    threadId: z.string(),
    runId: z.string().nullable(),
    ordinal: z.number().int().nonnegative(),
    progress: z.string(),
  })
  .strict();
type Entry = z.infer<typeof entry>;
export const reconciliationMarker = (id: string, index: number) =>
  `Restack reconciliation ${id}:${index}.`;

/** Immutable sequential intentions reserve the operation-wide budget before an
 * at-most-once delivery claim. Unknown sends wait for their actual instruction. */
export function recoveryReconciliation(
  journal: RecoveryJournal,
  operation: { id: string; issue: number; onto: string; context: string; mode?: 'review' },
  limit: number,
  canSend: (threadId: string, runId: string | null, ordinal: number) => Promise<boolean>,
  send: (threadId: string, prompt: string, signal?: AbortSignal) => Promise<unknown>
) {
  const current = async () => {
    let previous: Entry | null = null;
    for (let index = 1; ; index++) {
      const saved = await journal.read(`reconciliation-${index}.json`);
      if (!saved) return previous;
      previous = entry.parse(saved);
      if (previous.index !== index) throw new Error('Invalid recovery reconciliation sequence');
    }
  };
  const cancelled = async (signal?: AbortSignal) => {
    signal?.throwIfAborted();
    return !!(await journal.read('cancelled.json'));
  };
  const display = (value: Entry): Resolution => ({
    threadId: value.threadId,
    bindingAvailable: true,
    phase:
      value.kind === 'manual'
        ? 'manual-recovery'
        : value.phase === 'review' || operation.mode === 'review'
          ? 'reviewing'
          : 'resolving',
    active: value.kind !== 'manual',
    progress: value.progress,
  });
  const deliver = async (value: Entry, signal?: AbortSignal) => {
    if (value.kind === 'manual' || (await cancelled(signal))) return;
    if (!(await canSend(value.threadId, value.runId, value.ordinal))) return;
    if (await cancelled(signal)) return;
    if (!(await journal.write(`reconciliation-send-${value.index}.json`, value))) return;
    // Cancellation after the claim cannot authorize a repeat delivery on restart.
    if (await cancelled(signal)) return;
    await send(
      value.threadId,
      `Factory instruction ${operation.id}:${value.phase}. ${reconciliationMarker(operation.id, value.index)} ${value.kind === 'migration' ? 'Your response format is obsolete or unsupported. Migrate once to version 1.' : 'Reconcile the inconsistent current recovery state.'} Continue only this operation in this owning thread and worktree. Do not rebase again, publish, choose another base or stack, implement another issue, expand scope or add test seams. Do not clean Git or discard unrelated work. Reconcile actual external outcomes before effects; preserve retained decisions, worktrees and publication ownership. Only https://github.com/rafaeltab/wallpaperdb/issues/${operation.issue} is authorized. Verify the exact intended comparison ${operation.onto}, clean current HEAD and applicable local checks. ${value.phase === 'review' || operation.mode === 'review' ? 'Complete fresh independent Standards, Spec and Defects review; reviewed must match checked.' : 'Preserve the required resolution classification and include fresh reviewed evidence whenever this operation requires review.'} ${value.phase === 'resolve' ? 'Report a separate <RESTACK>SIMPLE</RESTACK> or <RESTACK>COMPLEX</RESTACK> classification before the JSON; classification never waives review.' : ''} Return the latest coherent shared state only after its requirements pass; never invent successful checks or accept missing review evidence. Otherwise leave incomplete. Shared TypeScript response contract:\n\`\`\`typescript\n${responseShape}\n\`\`\`\nUse jobId=${JSON.stringify(operation.id)}, implemented=${JSON.stringify(String(operation.issue))}, base=${JSON.stringify(operation.onto)}. Context: ${operation.context}`,
      signal
    );
  };
  return {
    current,
    advance: async (
      phase: Entry['phase'],
      worker: { threadId: string; runId: string | null; ordinal: number; acknowledged: boolean },
      migration: boolean,
      signal?: AbortSignal
    ): Promise<Resolution> => {
      if (await cancelled(signal))
        return {
          phase: 'manual-recovery',
          active: false,
          progress: 'Recovery cancelled; retained for manual recovery',
        };
      const previous = await current();
      if (previous?.kind === 'manual') return display(previous);
      if (previous && previous.threadId !== worker.threadId) {
        const stopped: Entry = {
          ...previous,
          index: previous.index + 1,
          kind: 'manual',
          progress: 'Recovery owning worker changed; manual recovery required',
        };
        await journal.write(`reconciliation-${stopped.index}.json`, stopped);
        return display(entry.parse(await journal.read(`reconciliation-${stopped.index}.json`)));
      }
      if (previous?.phase === phase && !worker.acknowledged) {
        const claimed = await journal.read(`reconciliation-send-${previous.index}.json`);
        if (claimed || (previous.runId === worker.runId && previous.ordinal === worker.ordinal)) {
          await deliver(previous, signal);
          return display(previous);
        }
        // A newer run overtook an unsent intention. Its reserved attempt remains
        // spent, but only an actual send claim can require uncertain-delivery waiting.
      }
      const attempts = previous?.attempts ?? 0;
      const migrated = previous?.migrated ?? false;
      const exhausted = migration ? migrated : attempts >= limit;
      const value: Entry = {
        index: (previous?.index ?? 0) + 1,
        phase,
        kind: exhausted ? 'manual' : migration ? 'migration' : 'state',
        attempts: attempts + (!exhausted && !migration ? 1 : 0),
        migrated: migrated || (!exhausted && migration),
        threadId: worker.threadId,
        runId: worker.runId,
        ordinal: worker.ordinal,
        progress: exhausted
          ? migration
            ? 'Recovery response migration failed; manual intervention required'
            : 'Recovery reconciliation attempt limit reached; manual intervention required'
          : migration
            ? 'Migrating recovery response to version 1'
            : `Recovery reconciliation attempt ${attempts + 1} of ${limit}`,
      };
      await journal.write(`reconciliation-${value.index}.json`, value);
      const saved = entry.parse(await journal.read(`reconciliation-${value.index}.json`));
      await deliver(saved, signal);
      return display(saved);
    },
  };
}

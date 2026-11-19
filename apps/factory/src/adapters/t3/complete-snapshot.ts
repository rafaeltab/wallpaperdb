import { z } from 'zod';
import { projection } from './observed-model.js';

/** Recover the complete managed transcript through the supported full-snapshot endpoint. */
export async function t3CompleteSnapshot(config: {
  origin: string;
  token: string;
  signal: AbortSignal;
  threadId: string;
}) {
  const signal = AbortSignal.any([config.signal, AbortSignal.timeout(30000)]);
  const response = await fetch(
    new URL(`/api/orchestration/threads/${encodeURIComponent(config.threadId)}`, config.origin),
    {
      headers: {
        authorization: `Bearer ${config.token}`,
        'x-t3-orchestration-protocol': '2',
      },
      redirect: 'error',
      signal,
    }
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`T3 complete observation failed: HTTP ${response.status}`);
  }
  const value = z
    .object({
      snapshotSequence: z.number().int().nonnegative(),
      projection,
      hasMoreHistory: z.literal(false).optional(),
      turnItemsOmitLocalVisible: z.literal(false).optional(),
      payloadBudgetExceeded: z.literal(false).optional(),
    })
    .parse(await response.json());
  signal.throwIfAborted();
  if (value.projection.thread.id !== config.threadId)
    throw new Error('Mismatched complete T3 thread snapshot');
  return value;
}

import type { ScheduleSnapshot } from '../../src/capabilities/observe/index.js';
import type { AttemptResult, PlanningAttempt } from '../../src/capabilities/plan/index.js';
export type { ScheduleSnapshot, AttemptResult };
export type Attempt = Omit<PlanningAttempt, 'phase'> & { phase: string; elapsedMs: number };

export async function read<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  if (!response.ok) throw new Error('Observation unavailable');
  return response.json();
}

/** Synchronous reservation protects against two commands before React rerenders. */
export function commands() {
  let pending = false;
  return async <T>(path: string, body: unknown): Promise<T> => {
    if (pending) throw new Error('A command is already pending');
    pending = true;
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.title ?? 'Command rejected');
      return result;
    } catch (error) {
      if (error instanceof TypeError)
        throw new Error('Request uncertain. Refresh observation before retrying.');
      throw error;
    } finally {
      pending = false;
    }
  };
}
export function stage(phase: string) {
  switch (phase) {
    case 'discovery':
      return { label: 'Gathering issues', value: 1 };
    case 'handoff':
      return { label: 'Handing off to planner', value: 2 };
    case 'freshness':
      return { label: 'Validating freshness', value: 3 };
    case 'succeeded':
      return { label: 'Preview succeeded', value: 4 };
    case 'failed':
      return { label: 'Preview failed', value: undefined };
    default:
      return { label: phase, value: undefined };
  }
}

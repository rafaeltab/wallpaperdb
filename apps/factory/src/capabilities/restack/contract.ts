import { Context, type Effect } from 'effect';
import type { Unavailable } from '../job/index.js';
export interface Resolution {
  readonly classification?: 'SIMPLE' | 'COMPLEX';
  readonly commit?: string;
  readonly progress: string;
  /** Observation of the expected recovery worker; omitted when none is required. */
  readonly bindingAvailable?: boolean;
  readonly active?: boolean;
  readonly threadId?: string;
  readonly question?: string;
}
export interface RecoveryOutcome extends Resolution {
  readonly ready: boolean;
}
/** The agent adapter binds observations to the operation, run and clean current head.
 * Review attests a fresh review-loop of that head; verify publishes with a lease
 * and checks CI on that same head. Unknown delivery remains pending. */
export interface RecoveryPorts {
  resolve(): Effect.Effect<Resolution, Unavailable>;
  review(commit: string): Effect.Effect<boolean, Unavailable>;
  verify(commit: string): Effect.Effect<boolean, Unavailable>;
}
export const RecoveryPorts = Context.Service<RecoveryPorts>('wallpaperdb.factory.RecoveryPorts');
export interface Restack {
  advance(): Effect.Effect<RecoveryOutcome, Unavailable>;
}
export const Restack = Context.Service<Restack>('wallpaperdb.factory.Restack');

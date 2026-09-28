import { Context, Data, type Effect } from 'effect';
import type { AliasClaimReference } from '../profile/index.js';

export class MaintenanceFailure extends Data.TaggedError('MaintenanceFailure')<{
  readonly operation: string;
  readonly cause: unknown;
}> {}

export interface EventReference {
  readonly id: string;
  readonly createdAt: Date;
}

export interface DueAlias extends AliasClaimReference {
  readonly expiresAt: Date;
}

export interface BatchResult {
  readonly completed: number;
  readonly failed: number;
}

export interface WallpaperOwnership {
  readonly wallpaperId: string;
  readonly profileId: string;
}

/** Reads only unpublished Profile events in stable creation/identity order, in pages of 100. */
export interface MaintenanceStore {
  /** Due aliases in expiry/Handle order, at most 100. Expiry must recheck the claim before changing it. */
  dueAliases(now: Date, after?: DueAlias): Effect.Effect<readonly DueAlias[], MaintenanceFailure>;
  pendingEvents(
    after?: EventReference
  ): Effect.Effect<readonly EventReference[], MaintenanceFailure>;
  /** Marks only the identified, still unpublished event after its publication was acknowledged. */
  markPublished(id: string, now: Date): Effect.Effect<void, MaintenanceFailure>;
  /** Only acknowledged Profile evidence at/before cutoff is eligible; pages contain at most 100. */
  expiredEvents(
    cutoff: Date,
    after?: EventReference
  ): Effect.Effect<readonly EventReference[], MaintenanceFailure>;
  /** Rechecks publication, subject and cutoff before deletion; unrelated records never change. */
  deleteExpiredEvent(id: string, cutoff: Date): Effect.Effect<boolean, MaintenanceFailure>;
  /** The first accepted owner remains immutable under concurrent duplicates and later conflicting facts. */
  recordWallpaperOwnership(ownership: WallpaperOwnership): Effect.Effect<void, MaintenanceFailure>;
}

export const MaintenanceStore = Context.Service<MaintenanceStore>(
  'wallpaperdb.user.MaintenanceStore'
);

/** Publishes the recorded event using its original identity; success requires durable broker acceptance. */
export interface ProfileEvents {
  publish(eventId: string): Effect.Effect<void, MaintenanceFailure>;
}

export const ProfileEvents = Context.Service<ProfileEvents>('wallpaperdb.user.ProfileEvents');

export interface Maintenance {
  expireAliases(
    now: Date,
    isStopping?: () => boolean
  ): Effect.Effect<BatchResult, MaintenanceFailure>;
  publishPending(isStopping?: () => boolean): Effect.Effect<BatchResult, MaintenanceFailure>;
  cleanupEvents(
    now: Date,
    isStopping?: () => boolean
  ): Effect.Effect<{ deleted: number; failed: number }, MaintenanceFailure>;
  recordWallpaperOwnership(ownership: WallpaperOwnership): Effect.Effect<void, MaintenanceFailure>;
}

export const Maintenance = Context.Service<Maintenance>('wallpaperdb.user.Maintenance');

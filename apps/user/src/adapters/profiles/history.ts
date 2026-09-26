import {
  PROFILE_CREATED_SUBJECT,
  PROFILE_UPDATED_SUBJECT,
  type ProfileUpdatedEvent,
  type ProfileCreatedEvent,
} from '@wallpaperdb/events';
import { and, eq, gt, lte, or, sql } from 'drizzle-orm';
import type { Database } from '../database/index.js';
import { outboxEvents } from '../../db/schema.js';

export type ProfileReader = Pick<Parameters<Parameters<Database['run']>[0]>[0], 'query' | 'select'>;

/** Read typed Handle references without loading the full public snapshots. */
export async function recentHistoricalHandles(
  reader: ProfileReader,
  profileId: string,
  now: Date,
  retentionMs: number
) {
  const events = await reader
    .select({
      createdAt: outboxEvents.createdAt,
      createdHandle: sql<
        string | null
      >`case when ${outboxEvents.subject} = ${PROFILE_CREATED_SUBJECT} then ${outboxEvents.payload}->'profile'->>'handle' else null end`,
      change: sql<
        ProfileUpdatedEvent['change'] | ProfileCreatedEvent['change'] | null
      >`${outboxEvents.payload}->'change'`,
    })
    .from(outboxEvents)
    .where(
      and(
        eq(outboxEvents.aggregateId, profileId),
        gt(outboxEvents.createdAt, new Date(now.getTime() - retentionMs)),
        lte(outboxEvents.createdAt, now),
        or(
          eq(outboxEvents.subject, PROFILE_CREATED_SUBJECT),
          and(
            eq(outboxEvents.subject, PROFILE_UPDATED_SUBJECT),
            sql`${outboxEvents.payload}->'change'->>'type' in ('handle-changed', 'alias-expiry-scheduled', 'alias-expired', 'alias-reactivated')`
          )
        )
      )
    );
  const deadlines = new Map<string, number>();
  for (const event of events) {
    const handles: string[] = [];
    if (event.createdHandle) handles.push(event.createdHandle);
    const change = event.change;
    if (change?.type === 'handle-changed') {
      handles.push(
        change.before,
        change.after,
        ...(change.scheduledAliases ?? []).map((alias) => alias.handle)
      );
    } else if (change && 'handle' in change) {
      handles.push(change.handle);
    }
    const deadline = event.createdAt.getTime() + retentionMs;
    for (const handle of handles)
      deadlines.set(handle, Math.max(deadlines.get(handle) ?? 0, deadline));
  }
  return [...deadlines]
    .sort(
      ([left, leftDeadline], [right, rightDeadline]) =>
        rightDeadline - leftDeadline || left.localeCompare(right)
    )
    .map(([handle, deadline]) => ({ handle, eligibleUntil: new Date(deadline).toISOString() }));
}

import { and, eq } from 'drizzle-orm';
import {
  records,
  stateConnection,
  intentSchema,
  controlSchema,
  scheduleSchema,
} from '../../platform/index.js';
import type { ScheduleState, ScheduleStore } from '../../capabilities/plan/index.js';

/** Both journals share this SQLite transaction. Cancellation/retry revisions cannot
 * interleave between the handback guard and allowance release. */
export function saveHandback(
  directory: string,
  state: ScheduleState,
  guards: NonNullable<Parameters<ScheduleStore['save']>[1]>
) {
  return stateConnection(directory, (db, namespace) =>
    db.transaction(
      (tx) => {
        if (
          state.revision > 0 &&
          !tx
            .select()
            .from(records)
            .where(
              and(
                eq(records.namespace, namespace),
                eq(records.name, `schedule-${state.revision - 1}.json`)
              )
            )
            .get()
        )
          return false;
        if (
          tx
            .select()
            .from(records)
            .where(
              and(
                eq(records.namespace, namespace),
                eq(records.name, `schedule-${state.revision}.json`)
              )
            )
            .get()
        )
          return false;
        const completed: { namespace: string; control: ReturnType<typeof controlSchema.parse> }[] =
          [];
        const intents = tx.select().from(records).where(eq(records.name, 'intent.json')).all();
        for (const guard of guards) {
          const matches = intents.filter((record) => {
            const parsed = intentSchema.safeParse(record.value);
            return (
              parsed.success &&
              parsed.data.id === guard.jobId &&
              parsed.data.issue === guard.issue &&
              (parsed.data.generation ?? 0) === (guard.generation ?? 0)
            );
          });
          if (matches.length !== 1) return false;
          const owner = matches[0];
          if (!owner) return false;
          const controls = tx
            .select()
            .from(records)
            .where(eq(records.namespace, owner.namespace))
            .all()
            .filter((record) => /^control-[0-9]+\.json$/.test(record.name))
            .map((record) => controlSchema.parse(record.value));
          const current = controls.reduce<ReturnType<typeof controlSchema.parse> | undefined>(
            (latest, value) => (!latest || value.revision > latest.revision ? value : latest),
            undefined
          );
          if (
            !current ||
            current.cancelled ||
            current.released ||
            current.revision !== guard.controlRevision
          )
            return false;
          if (completed.some((entry) => entry.namespace === owner.namespace)) return false;
          completed.push({ namespace: owner.namespace, control: current });
        }
        for (const entry of completed)
          tx.insert(records)
            .values({
              namespace: entry.namespace,
              name: `control-${entry.control.revision + 1}.json`,
              value: controlSchema.parse({
                ...entry.control,
                revision: entry.control.revision + 1,
                released: true,
              }),
            })
            .run();
        return (
          tx
            .insert(records)
            .values({
              namespace,
              name: `schedule-${state.revision}.json`,
              value: scheduleSchema.parse(state),
            })
            .run().changes === 1
        );
      },
      { behavior: 'immediate' }
    )
  );
}

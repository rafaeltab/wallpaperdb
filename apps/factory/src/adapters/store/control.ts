import { mkdirSync } from 'node:fs';
import { and, eq } from 'drizzle-orm';
import type { Control, StageRequest } from '../../capabilities/job/index.js';
import { controlSchema, stageSchema, stateConnection, records } from '../../platform/index.js';

/** Reserve the instruction and its budget together, before any delivery claim. */
export function saveStageControl(directory: string, state: Control, request: StageRequest) {
  const control = controlSchema.parse(state);
  const stage = stageSchema.parse(request);
  if (JSON.stringify(control.reconciliation?.pending) !== JSON.stringify(stage)) return false;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return stateConnection(directory, (db, namespace) =>
    db.transaction(
      (tx) => {
        const exists = (name: string) =>
          tx
            .select()
            .from(records)
            .where(and(eq(records.namespace, namespace), eq(records.name, name)))
            .get();
        const controlName = `control-${control.revision}.json`;
        const stageName = `stage-${stage.index}.json`;
        if (
          exists(controlName) ||
          exists(stageName) ||
          (control.revision > 0 && !exists(`control-${control.revision - 1}.json`))
        )
          return false;
        tx.insert(records)
          .values([
            { namespace, name: controlName, value: control },
            { namespace, name: stageName, value: stage },
          ])
          .run();
        return true;
      },
      { behavior: 'immediate' }
    )
  );
}

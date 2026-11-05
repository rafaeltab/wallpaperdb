import { resolve } from 'node:path';
import { Effect } from 'effect';
import type { LocalSnapshot } from '../../capabilities/observe/index.js';
import { fileStore, fileScheduleStore } from './implementation.js';
/** Translate durable namespace identities without constructing or observing job runtimes. */
export function sqliteLocalSnapshot(directory: string): LocalSnapshot {
  const schedule = fileScheduleStore(directory);
  const root = fileStore(directory);
  return {
    read: () =>
      Effect.gen(function* () {
        const state = yield* schedule.read();
        const rootIntent = yield* root.read();
        const entries = [];
        for (const admission of state.admissions) {
          const store =
            rootIntent?.issue === admission.issue
              ? root
              : fileStore(resolve(directory, `issue-${admission.issue}`));
          entries.push({ intent: yield* store.read(), control: yield* store.readControl() });
        }
        return { state, entries };
      }),
  };
}

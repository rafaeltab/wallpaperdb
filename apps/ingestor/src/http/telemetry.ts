import { recordCounter, recordHistogram } from '@wallpaperdb/core/telemetry';
import { Clock, Effect, Exit } from 'effect';
import type { IngestionUnavailable, UploadOutcome } from '../ingestion/index.js';
/** Keep the established upload metric names independent of telemetry availability. */
export function observeUpload(
  effect: Effect.Effect<UploadOutcome, IngestionUnavailable>,
  bytes: number
) {
  return Effect.gen(function* () {
    const started = yield* Clock.currentTimeMillis;
    return yield* effect.pipe(
      Effect.onExit((exit) =>
        Effect.gen(function* () {
          const ended = yield* Clock.currentTimeMillis;
          const result = Exit.isSuccess(exit) ? exit.value : undefined;
          const status =
            result?._tag === 'Accepted'
              ? 'success'
              : result?._tag === 'Duplicate'
                ? 'duplicate'
                : 'error';
          const fileType =
            result?._tag === 'Accepted' || result?._tag === 'Duplicate'
              ? result.upload.fileType
              : 'unknown';
          yield* Effect.try(() => {
            recordCounter('upload.requests.total', 1, { status, 'file.type': fileType });
            recordHistogram('upload.duration_ms', ended - started, {
              status,
              'file.type': fileType,
            });
            recordHistogram('upload.file_size_bytes', bytes, { 'file.type': fileType });
          }).pipe(Effect.ignore);
        })
      )
    );
  });
}

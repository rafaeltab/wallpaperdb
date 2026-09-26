import { uploadEnvelopeConformance } from '@wallpaperdb/test-utils/event-contracts';
import { expect, it } from 'vitest';
import { Effect } from 'effect';
import { deliverProjection } from '../src/adapters/events/index.js';
import { ProjectCatalogue, type ProjectionChange } from '../src/projection/index.js';
it.each(uploadEnvelopeConformance())('$name', async ({ payload, metadata, accepted, expected }) => {
  const changes: ProjectionChange[] = [];
  const result = await Effect.runPromise(
    deliverProjection({
      subject: 'wallpaper.uploaded',
      payload,
      headers: metadata,
      attempt: 1,
    }).pipe(
      Effect.provideService(ProjectCatalogue, {
        record: (change) =>
          Effect.sync(() => {
            changes.push(change);
            return { _tag: 'Completed' as const };
          }),
      })
    )
  );
  expect(result._tag === 'Completed').toBe(accepted);
  expect(changes).toHaveLength(accepted ? 1 : 0);
  if (expected)
    expect(changes[0]?.occurrence).toMatchObject({ source: expected.source, id: expected.id });
});

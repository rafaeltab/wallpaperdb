import { Clock, Effect, Layer } from 'effect';
import { TestClock } from 'effect/testing';
import {
  AssetStorage,
  ContentInspection,
  IngestionIdentity,
  IngestionStore,
  UploadEvents,
  ingestionLayer,
  type AssetReference,
  type UploadedEvent,
  type UploadRecord,
} from '../../src/ingestion/index.js';

export const metadata = {
  fileType: 'image' as const,
  mimeType: 'image/png',
  width: 1920,
  height: 1080,
  fileSizeBytes: 3,
  contentHash: 'hash',
  extension: 'png',
};
export const uploadInput = {
  principal: { profileId: 'profile-1' },
  bytes: new Uint8Array([1, 2, 3]),
  filename: '../wallpaper.png',
  declaredMimeType: 'image/png',
};

export class ControlledStore implements IngestionStore {
  readonly records = new Map<string, UploadRecord>();
  readonly outbox = new Map<string, UploadedEvent>();
  readonly deadlines = new Map<string, { changed: number; lease: number }>();
  private readonly quarantined = new Set<string>();
  private owns(record: UploadRecord) {
    const current = this.records.get(record.wallpaper.id);
    return current?.state === record.state && current.leaseToken === record.leaseToken;
  }
  reserve: IngestionStore['reserve'] = (record, leaseUntil) =>
    Clock.currentTimeMillis.pipe(
      Effect.map((now) => {
        const existing = [...this.records.values()].find(
          (entry) =>
            entry.state !== 'failed' &&
            entry.wallpaper.profileId === record.wallpaper.profileId &&
            entry.wallpaper.metadata.contentHash === record.wallpaper.metadata.contentHash
        );
        if (existing) return { _tag: 'Existing', record: existing };
        this.records.set(record.wallpaper.id, record);
        this.deadlines.set(record.wallpaper.id, { changed: now, lease: leaseUntil.getTime() });
        return { _tag: 'Reserved', record };
      })
    );
  stored: IngestionStore['stored'] = (record) =>
    Clock.currentTimeMillis.pipe(
      Effect.map((now) => {
        if (!this.owns(record) || record.state !== 'uploading') return false;
        this.records.set(record.wallpaper.id, { ...record, state: 'stored', attempts: 0 });
        this.deadlines.set(record.wallpaper.id, {
          changed: now,
          lease: this.deadlines.get(record.wallpaper.id)?.lease ?? 0,
        });
        this.outbox.set(record.event.id, record.event);
        return true;
      })
    );
  published: IngestionStore['published'] = (record) =>
    Effect.sync(() => {
      if (!this.owns({ ...record, state: 'stored' })) return;
      this.records.set(record.wallpaper.id, { ...record, state: 'processing' });
      this.outbox.delete(record.event.id);
    });
  defer: IngestionStore['defer'] = (record, now, maxAttempts) =>
    Effect.sync(() => {
      if (!this.owns(record)) return;
      const attempts = record.attempts + 1;
      if (record.state === 'stored' && attempts >= maxAttempts) {
        this.quarantined.add(record.event.id);
      }
      this.records.set(record.wallpaper.id, {
        ...record,
        attempts,
        state: record.state === 'uploading' && attempts >= maxAttempts ? 'failed' : record.state,
      });
      this.deadlines.set(record.wallpaper.id, { changed: now.getTime(), lease: 0 });
    });
  claim: IngestionStore['claim'] = (now, staleBefore, leaseUntil, limit) =>
    Effect.sync(() => {
      const records = [...this.records.values()]
        .filter((record) => {
          const deadline = this.deadlines.get(record.wallpaper.id);
          return (
            (record.state === 'uploading' ||
              (record.state === 'stored' &&
                this.outbox.has(record.event.id) &&
                !this.quarantined.has(record.event.id))) &&
            Boolean(
              deadline &&
                deadline.changed < staleBefore.getTime() &&
                deadline.lease <= now.getTime()
            )
          );
        })
        .slice(0, limit);
      return records.map((record) => {
        const claimed = { ...record, leaseToken: `${record.leaseToken}-claimed` };
        this.records.set(record.wallpaper.id, claimed);
        this.deadlines.set(record.wallpaper.id, {
          changed: this.deadlines.get(record.wallpaper.id)?.changed ?? now.getTime(),
          lease: leaseUntil.getTime(),
        });
        return claimed;
      });
    });
  expireIntents = () => Effect.void;
  assetDisposition: IngestionStore['assetDisposition'] = (id) =>
    Effect.sync(() => {
      const record = this.records.get(id);
      return !record || record.state === 'failed' ? 'remove' : 'retain';
    });
}
export function fixture(
  overrides: {
    inspection?: ContentInspection;
    storage?: Partial<AssetStorage>;
    events?: UploadEvents;
  } = {}
) {
  const store = new ControlledStore();
  const objects: AssetReference[] = [];
  const published: UploadedEvent[] = [];
  let sequence = 0;
  const storage: AssetStorage = {
    put: (input) =>
      Effect.sync(() => {
        objects.push({ wallpaperId: input.wallpaperId, extension: input.metadata.extension });
      }),
    exists: (ref) =>
      Effect.sync(() =>
        objects.some(
          (item) => item.wallpaperId === ref.wallpaperId && item.extension === ref.extension
        )
      ),
    remove: (ref) =>
      Effect.sync(() => {
        const index = objects.findIndex((item) => item.wallpaperId === ref.wallpaperId);
        if (index >= 0) objects.splice(index, 1);
      }),
    list: () => Effect.succeed({ assets: [...objects] }),
    ...overrides.storage,
  };
  const layer = ingestionLayer().pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(IngestionStore, store),
        Layer.succeed(IngestionIdentity, {
          next: () =>
            Effect.sync(() => {
              sequence++;
              return {
                wallpaperId: `wlpr_${sequence}`,
                eventId: `event-${sequence}`,
                correlationId: `workflow-${sequence}`,
                causationId: `command-${sequence}`,
                leaseToken: `lease-${sequence}`,
              };
            }),
        }),
        Layer.succeed(
          ContentInspection,
          overrides.inspection ?? { inspect: () => Effect.succeed({ _tag: 'Inspected', metadata }) }
        ),
        Layer.succeed(AssetStorage, storage),
        Layer.succeed(
          UploadEvents,
          overrides.events ?? {
            publish: (event) =>
              Effect.sync(() => {
                published.push(event);
              }),
          }
        )
      )
    ),
    Layer.provideMerge(TestClock.layer())
  );
  return {
    store,
    objects,
    published,
    layer,
    advance: (milliseconds = 11 * 60_000) => TestClock.adjust(milliseconds),
  };
}

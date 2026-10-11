import { DateTime, Schema } from 'effect';
import {
  ColorMeasurementsSchema,
  COLOR_ANCHORS_SHA256,
  COLOR_REFERENCE_COMMIT,
} from '@wallpaperdb/events';
import { COLOR_UTILITY_VERSION, encodeColorUtilities } from '../../capabilities/catalogue/index.js';
import type { ProjectionChange } from '../../capabilities/projection/index.js';
import { variantDocument, timestamp } from './documents.js';

const colorSnapshot = Schema.Struct({
  descriptor: Schema.Struct({
    version: Schema.String,
    sampleCount: Schema.Int,
    layers: Schema.Array(
      Schema.Struct({
        cutoff: Schema.Number,
        coverage: Schema.Array(Schema.Int),
        quality: Schema.Array(Schema.Number),
      })
    ),
    named: Schema.Record(
      Schema.String,
      Schema.Struct({ coverage: Schema.Int, quality: Schema.Number })
    ),
  }),
  original: Schema.Struct({ owner: Schema.Literal('ingestor'), id: Schema.NonEmptyString }),
  provenance: Schema.Struct({
    referenceCommit: Schema.String.check(
      Schema.makeFilter((value) => value === COLOR_REFERENCE_COMMIT)
    ),
    anchorsSha256: Schema.String.check(
      Schema.makeFilter((value) => value === COLOR_ANCHORS_SHA256)
    ),
    originalSha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  }),
});
const storedWallpaper = Schema.Struct({
  wallpaperId: Schema.NonEmptyString,
  userId: Schema.optionalKey(Schema.NonEmptyString),
  uploadedAt: Schema.optionalKey(timestamp),
  updatedAt: timestamp,
  variants: Schema.Array(variantDocument),
  variantOrder: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  colorOrder: Schema.optionalKey(Schema.String),
  colorReady: Schema.optionalKey(Schema.Literal(COLOR_UTILITY_VERSION)),
  colorSnapshot: Schema.optionalKey(colorSnapshot),
}).check(
  Schema.makeFilter((document) => {
    if (document.colorSnapshot === undefined)
      return document.colorReady === undefined && document.colorOrder === undefined;
    return (
      document.colorReady === COLOR_UTILITY_VERSION &&
      document.colorOrder !== undefined &&
      document.colorSnapshot.original.id === document.wallpaperId &&
      ColorMeasurementsSchema.safeParse(document.colorSnapshot.descriptor).success
    );
  })
);
export const storedWallpaperResponse = Schema.decodeUnknownEffect(
  Schema.Struct({
    _index: Schema.NonEmptyString,
    _id: Schema.NonEmptyString,
    _seq_no: Schema.Int,
    _primary_term: Schema.Int,
    _source: storedWallpaper,
  })
);
export type StoredWallpaper = typeof storedWallpaper.Type;
export const indexResponse = Schema.decodeUnknownEffect(
  Schema.Struct({
    _index: Schema.NonEmptyString,
    _id: Schema.NonEmptyString,
    result: Schema.Literals(['created', 'updated']),
    _shards: Schema.Struct({ failed: Schema.Literal(0) }),
  })
);

function comparableOrder(order: string): string {
  const separator = order.indexOf('/');
  return order.slice(0, separator - 1) + order.slice(separator);
}

export function nextWallpaper(
  current: StoredWallpaper | null,
  change: Exclude<ProjectionChange, { _tag: 'ProfilePublished' }>
): StoredWallpaper | null {
  const updatedAt = DateTime.formatIso(DateTime.makeUnsafe(change.occurrence.occurredAt));
  const snapshot: StoredWallpaper = current ?? {
    wallpaperId: change.wallpaperId,
    variants: [],
    updatedAt,
  };
  const order = `${change.occurrence.occurredAt}/${JSON.stringify([change.occurrence.source, change.occurrence.id])}`;
  const advanced = {
    ...snapshot,
    updatedAt: snapshot.updatedAt > updatedAt ? snapshot.updatedAt : updatedAt,
  };
  switch (change._tag) {
    case 'WallpaperUploaded':
      return snapshot.userId !== undefined
        ? null
        : { ...advanced, userId: change.profileId, uploadedAt: change.uploadedAt };
    case 'VariantAvailable': {
      const variant = change.variant;
      const key = JSON.stringify([variant.width, variant.height, variant.format]);
      const previous = snapshot.variantOrder?.[key];
      if (previous !== undefined && comparableOrder(previous) >= comparableOrder(order))
        return null;
      return {
        ...advanced,
        variants: [
          ...snapshot.variants.filter(
            (existing) =>
              existing.width !== variant.width ||
              existing.height !== variant.height ||
              existing.format !== variant.format
          ),
          variant,
        ],
        variantOrder: { ...snapshot.variantOrder, [key]: order },
      };
    }
    case 'ColorsMeasured':
      return snapshot.colorOrder !== undefined &&
        comparableOrder(snapshot.colorOrder) >= comparableOrder(order)
        ? null
        : {
            ...advanced,
            colorOrder: order,
            colorReady: COLOR_UTILITY_VERSION,
            colorSnapshot: {
              descriptor: change.descriptor,
              provenance: change.provenance,
              original: change.original,
            },
          };
  }
}

export function completeWallpaper(
  snapshot: StoredWallpaper
): StoredWallpaper & { utilities?: Record<string, number> } {
  return snapshot.colorSnapshot === undefined
    ? snapshot
    : { ...snapshot, utilities: encodeColorUtilities(snapshot.colorSnapshot.descriptor) };
}

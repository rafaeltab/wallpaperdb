import { DateTime } from 'effect';
import type { ProjectionMutation } from '../../projection/index.js';

// Removing the UTC suffix makes the separator sort before another fractional digit.
// The stored format stays compatible with existing millisecond occurrence keys.
const compareOrder = `
  String comparableOrder(String order) {
    int separator = order.indexOf('/');
    return order.substring(0, separator - 1) + order.substring(separator);
  }
`;

const advanceUpdatedAt = `
  if (ctx._source.updatedAt == null || params.updatedAt.compareTo(ctx._source.updatedAt) > 0) {
    ctx._source.updatedAt = params.updatedAt;
  }
`;

export function projectionUpdate(mutation: ProjectionMutation) {
  const occurrence = mutation.occurrence;
  const order = `${occurrence.occurredAt}/${JSON.stringify([occurrence.source, occurrence.id])}`;
  const updatedAt = DateTime.formatIso(DateTime.makeUnsafe(occurrence.occurredAt));
  switch (mutation._tag) {
    case 'PublishWallpaper':
      return {
        scripted_upsert: true,
        script: {
          lang: 'painless',
          source: `
          if (ctx._source.userId != null) { ctx.op = 'none'; }
          else {
            ctx._source.userId = params.userId;
            ctx._source.uploadedAt = params.uploadedAt;
            ${advanceUpdatedAt}
          }
        `,
          params: {
            userId: mutation.profileId,
            uploadedAt: mutation.uploadedAt,
            updatedAt,
          },
        },
        upsert: { wallpaperId: mutation.wallpaperId, variants: [] },
      };
    case 'PublishVariant':
      return {
        scripted_upsert: true,
        script: {
          lang: 'painless',
          source: `
          ${compareOrder}
          if (ctx._source.variantOrder == null) { ctx._source.variantOrder = [:]; }
          def previous = ctx._source.variantOrder[params.key];
          if (previous == null) {
            for (def existing : ctx._source.variants) {
              if (existing.width == params.variant.width && existing.height == params.variant.height && existing.format == params.variant.format && ZonedDateTime.parse(existing.createdAt).toInstant().toEpochMilli() > params.createdAtMillis) {
                ctx.op = 'none';
                break;
              }
            }
          }
          if (previous != null && comparableOrder(params.order).compareTo(comparableOrder(previous)) <= 0) { ctx.op = 'none'; }
          if (ctx.op != 'none') {
            ctx._source.variants.removeIf(v -> v.width == params.variant.width && v.height == params.variant.height && v.format == params.variant.format);
            ctx._source.variants.add(params.variant);
            ctx._source.variantOrder[params.key] = params.order;
            ${advanceUpdatedAt}
          }
        `,
          params: {
            variant: mutation.variant,
            createdAtMillis: new Date(mutation.variant.createdAt).getTime(),
            key: JSON.stringify([
              mutation.variant.width,
              mutation.variant.height,
              mutation.variant.format,
            ]),
            order,
            updatedAt,
          },
        },
        upsert: { wallpaperId: mutation.wallpaperId, variants: [] },
      };
    case 'PublishColors':
      return {
        scripted_upsert: true,
        script: {
          lang: 'painless',
          source: `
          ${compareOrder}
          if (ctx._source.colorOrder != null && comparableOrder(params.order).compareTo(comparableOrder(ctx._source.colorOrder)) <= 0) { ctx.op = 'none'; }
          else {
            ctx._source.colorHistogram = params.colorHistogram;
            ctx._source.colorSpace = params.colorSpace;
            ctx._source.colorOrder = params.order;
            ${advanceUpdatedAt}
          }
        `,
          params: {
            colorHistogram: mutation.colorHistogram,
            colorSpace: mutation.colorSpace,
            order,
            updatedAt,
          },
        },
        upsert: { wallpaperId: mutation.wallpaperId, variants: [] },
      };
    case 'PublishProfile':
      return {
        scripted_upsert: true,
        script: {
          lang: 'painless',
          source: `
          if (ctx.op == 'create' || params.profile.version > ctx._source.version) {
            ctx._source = params.profile;
          } else { ctx.op = 'none'; }
        `,
          params: { profile: mutation.profile },
        },
        upsert: mutation.profile,
      };
  }
}

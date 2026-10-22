import { AssetSourceAcceptedSchema } from '@wallpaperdb/events/schemas';
import type { SourcePublication } from '../../capabilities/sources/index.js';
export function encodeSourceConfirmation(publication: SourcePublication) {
  const { id: _id, applicationId, context, ...data } = publication.confirmation;
  return {
    subject: `asset.results.${applicationId}`,
    event: {
      specversion: '1.0',
      id: publication.id,
      source: 'https://wallpaperdb/asset',
      type: 'asset.source.accepted',
      time: publication.occurredAt,
      datacontenttype: 'application/json',
      causationid: context.occurrence.id,
      causationsource: context.occurrence.source,
      ...(context.correlationId ? { correlationid: context.correlationId } : {}),
      ...(context.traceparent ? { traceparent: context.traceparent } : {}),
      ...(context.tracestate ? { tracestate: context.tracestate } : {}),
      data: AssetSourceAcceptedSchema.parse(data),
    },
  };
}

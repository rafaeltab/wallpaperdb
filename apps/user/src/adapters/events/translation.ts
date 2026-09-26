import {
  WallpaperUploadedCloudEventSchema,
  WallpaperUploadedEventSchema,
} from '@wallpaperdb/events/schemas';
import { Option, Predicate } from 'effect';
import type { MsgHdrs } from 'nats';
import { z } from 'zod';

const decode = Option.liftThrowable((bytes: Uint8Array): unknown =>
  JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
);
const envelope = z.object({
  specversion: z.literal('1.0'),
  source: z.string().url(),
  id: z.string().min(1),
  type: z.literal('wallpaper.uploaded'),
  time: z.string().datetime(),
  correlationid: z.string().min(1).optional(),
  causationid: z.string().min(1).optional(),
});
export function translateOwnership(subject: string, bytes: Uint8Array, headers?: MsgHdrs) {
  if (subject !== 'wallpaper.uploaded')
    return { kind: 'invalid', reason: 'validation_error' } as const;
  const raw = decode(bytes);
  if (Option.isNone(raw)) return { kind: 'invalid', reason: 'parse_error' } as const;
  const parsed = WallpaperUploadedEventSchema.safeParse(raw.value);
  if (!parsed.success) return { kind: 'invalid', reason: 'validation_error' } as const;
  if (
    Predicate.hasProperty(raw.value, 'specversion') &&
    !WallpaperUploadedCloudEventSchema.safeParse(raw.value).success
  )
    return { kind: 'invalid', reason: 'validation_error' } as const;
  const external = parsed.data;
  const structured = Predicate.hasProperty(raw.value, 'specversion')
    ? envelope.safeParse(raw.value)
    : undefined;
  const binary = headers?.keys().some((key) => key.toLowerCase().startsWith('ce-'))
    ? envelope.safeParse({
        specversion: headers.get('ce-specversion'),
        source: headers.get('ce-source'),
        id: headers.get('ce-id'),
        type: headers.get('ce-type'),
        time: headers.get('ce-time'),
        correlationid: headers.get('ce-correlationid') || undefined,
        causationid: headers.get('ce-causationid') || undefined,
      })
    : undefined;
  for (const parsedEnvelope of [structured, binary]) {
    if (
      parsedEnvelope &&
      (!parsedEnvelope.success ||
        parsedEnvelope.data.id !== external.eventId ||
        parsedEnvelope.data.time !== external.timestamp)
    )
      return { kind: 'invalid', reason: 'validation_error' } as const;
  }
  if (structured?.success && binary?.success && structured.data.source !== binary.data.source)
    return { kind: 'invalid', reason: 'validation_error' } as const;
  const metadata = structured?.success
    ? structured.data
    : binary?.success
      ? binary.data
      : undefined;
  return {
    kind: 'ownership' as const,
    ownership: { wallpaperId: external.wallpaper.id, profileId: external.wallpaper.userId },
    attributes: {
      'event.id': external.eventId,
      'event.source': metadata?.source ?? 'wallpaperdb/ingestor',
      'wallpaper.id': external.wallpaper.id,
      ...(metadata?.correlationid ? { 'event.correlation_id': metadata.correlationid } : {}),
      ...(metadata?.causationid ? { 'event.causation_id': metadata.causationid } : {}),
    },
  };
}

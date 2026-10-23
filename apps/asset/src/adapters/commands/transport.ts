import { createHash } from 'node:crypto';
import {
  AssetCommandResultSchema,
  CreateAssetSchema,
  DeleteAssetSchema,
} from '@wallpaperdb/events/schemas';
import { z } from 'zod';
import type {
  Command,
  CommandContext,
  ResultPublication,
} from '../../capabilities/lifecycle/index.js';

export interface CommandRoute {
  readonly subject: string;
  readonly applicationId: string;
  readonly operation: 'create' | 'delete';
}
const bounded = (bytes: number) =>
  z
    .string()
    .min(1)
    .refine((value) => Buffer.byteLength(value) <= bytes);
const envelope = z
  .object({
    specversion: z.literal('1.0'),
    id: bounded(128),
    source: z
      .string()
      .url()
      .refine((value) => Buffer.byteLength(value) <= 256),
    type: z.enum(['asset.command.create', 'asset.command.delete']),
    time: z.string().datetime().max(64),
    datacontenttype: z.literal('application/json'),
    correlationid: bounded(256).optional(),
    traceparent: bounded(128).optional(),
    tracestate: bounded(512).optional(),
    data: z.unknown(),
  })
  .strict();
const correlation = z.object({
  commandId: bounded(128),
  applicationReference: z.string().refine((value) => Buffer.byteLength(value) <= 256),
});
type Decoded =
  | { readonly kind: 'unroutable' | 'invalid' }
  | {
      readonly kind: 'command';
      readonly applicationId: string;
      readonly command: Command;
      readonly context: CommandContext;
    };
/** Bound traversal before recursive canonicalization, including malformed data. */
function boundedNesting(input: unknown): boolean {
  const pending: Array<{ value: unknown; depth: number }> = [{ value: input, depth: 0 }];
  while (pending.length) {
    const entry = pending.pop();
    if (!entry || entry.value === null || typeof entry.value !== 'object') continue;
    if (entry.depth >= 64) return false;
    for (const value of Object.values(entry.value)) pending.push({ value, depth: entry.depth + 1 });
  }
  return true;
}
function canonicalPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalPayload);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, canonicalPayload(entry)])
    );
  return value;
}
/** Only a route from trusted composition can select application authority. */
export function decodeAssetCommand(
  routes: readonly CommandRoute[],
  subject: string,
  data: Uint8Array
): Decoded {
  const route = routes.find((entry) => entry.subject === subject);
  if (!route) return { kind: 'unroutable' };
  if (data.byteLength > 16384) return { kind: 'invalid' };
  let input: unknown;
  try {
    input = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(data));
  } catch {
    return { kind: 'invalid' };
  }
  if (!boundedNesting(input)) return { kind: 'invalid' };
  const parsed = envelope.safeParse(input);
  if (!parsed.success || parsed.data.type !== `asset.command.${route.operation}`)
    return { kind: 'invalid' };
  const value = parsed.data;
  const context: CommandContext = {
    occurrence: { id: value.id, source: value.source },
    ...(value.correlationid ? { correlationId: value.correlationid } : {}),
    ...(value.traceparent ? { traceparent: value.traceparent } : {}),
    ...(value.tracestate ? { tracestate: value.tracestate } : {}),
  };
  if (route.operation === 'create') {
    const body = CreateAssetSchema.safeParse(value.data);
    if (body.success)
      return {
        kind: 'command',
        applicationId: route.applicationId,
        command: { operation: 'create', ...body.data },
        context,
      };
  } else {
    const body = DeleteAssetSchema.safeParse(value.data);
    if (body.success)
      return {
        kind: 'command',
        applicationId: route.applicationId,
        command: { operation: 'delete', ...body.data },
        context,
      };
  }
  const identifiers = correlation.safeParse(value.data);
  if (!identifiers.success) return { kind: 'invalid' };
  return {
    kind: 'command',
    applicationId: route.applicationId,
    context,
    command: {
      operation: route.operation,
      ...identifiers.data,
      invalid: true,
      payloadIdentity: createHash('sha256')
        .update(JSON.stringify(canonicalPayload(value.data)))
        .digest('hex'),
    },
  };
}
export function encodeAssetResult(publication: ResultPublication) {
  const data = AssetCommandResultSchema.parse(publication.result);
  return {
    subject: `asset.results.${publication.applicationId}`,
    event: {
      specversion: '1.0',
      id: publication.id,
      source: 'https://wallpaperdb/asset',
      type: 'asset.command.result',
      time: publication.occurredAt,
      datacontenttype: 'application/json',
      causationid: publication.context.occurrence.id,
      causationsource: publication.context.occurrence.source,
      ...(publication.context.correlationId
        ? { correlationid: publication.context.correlationId }
        : {}),
      ...(publication.context.traceparent ? { traceparent: publication.context.traceparent } : {}),
      ...(publication.context.tracestate ? { tracestate: publication.context.tracestate } : {}),
      data,
    },
  };
}

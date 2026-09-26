import type { MsgHdrs } from "nats";

export interface CloudEventMetadata {
  readonly specversion: "1.0";
  readonly source: string;
  readonly id: string;
  readonly type: string;
  readonly time: string;
  readonly correlationid?: string;
  readonly causationid?: string;
  readonly causationsource?: string;
}

type MetadataResult<M> =
  | { readonly valid: false }
  | { readonly valid: true; readonly value: M | undefined };

const fields = [
  "specversion",
  "source",
  "id",
  "type",
  "time",
  "correlationid",
  "causationid",
  "causationsource",
] as const;

/**
 * Reconcile structured and binary transport identities against the decoded event.
 * The caller's decoder owns allowed values and time normalization. Missing envelopes
 * preserve retained legacy input; partial, ambiguous or conflicting envelopes fail.
 * Structured payload validation and translation remain owned by the application.
 */
export function reconcileEventMetadata<M extends CloudEventMetadata>(
  raw: unknown,
  headers: MsgHdrs | undefined,
  event: { readonly eventId: string; readonly eventType: string; readonly timestamp: string },
  decode: (value: unknown) => M | undefined
): MetadataResult<M> {
  const hasStructured = typeof raw === "object" && raw !== null && "specversion" in raw;
  const hasBinary = headers?.keys().some((key) => key.toLowerCase().startsWith("ce-")) ?? false;
  const structured = hasStructured ? decode(raw) : undefined;
  let binary: M | undefined;
  if (hasBinary && headers) {
    const attributes: Record<string, string> = {};
    for (const field of fields) {
      const values = headers.values(`ce-${field}`);
      if (values.length > 1) return { valid: false };
      const value = headers.get(`ce-${field}`);
      if (value) attributes[field] = value;
    }
    binary = decode(attributes);
  }
  if ((hasStructured && !structured) || (hasBinary && !binary)) return { valid: false };
  for (const envelope of [structured, binary]) {
    if (
      envelope &&
      (envelope.id !== event.eventId ||
        envelope.type !== event.eventType ||
        envelope.time !== event.timestamp)
    ) {
      return { valid: false };
    }
  }
  if (structured && binary && fields.some((field) => structured[field] !== binary[field])) {
    return { valid: false };
  }
  return { valid: true, value: structured ?? binary };
}

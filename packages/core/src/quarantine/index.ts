import { createHash } from "node:crypto";
import { headers, type JsMsg, type MsgHdrs } from "nats";
import { z } from "zod";

interface QuarantineOwner {
  readonly stream: string;
  readonly source: string;
  readonly eventTypePrefix: string;
}
interface QuarantineInput {
  readonly subject: string;
  readonly data: Uint8Array;
  readonly headers?: MsgHdrs;
  readonly info: Pick<
    JsMsg["info"],
    "domain" | "account_hash" | "stream" | "consumer" | "streamSequence" | "timestampNanos"
  >;
}
export interface QuarantineRecord {
  readonly data: Uint8Array;
  readonly headers: MsgHdrs;
}
export interface QuarantinePlan {
  readonly records: readonly QuarantineRecord[];
  /** Publish this completion record only after every chunk has a durable sequence. */
  readonly manifest?: (sequences: readonly number[]) => QuarantineRecord;
}

export function quarantineIdentity(message: QuarantineInput) {
  const info = message.info;
  return createHash("sha256")
    .update(
      JSON.stringify([
        info.domain,
        info.account_hash,
        info.stream,
        info.consumer,
        info.streamSequence,
        info.timestampNanos,
      ])
    )
    .update(message.data)
    .digest("hex");
}
function metadata(
  owner: QuarantineOwner,
  message: QuarantineInput,
  reason: string,
  id: string,
  suffix: string,
  copyOriginal = true
): MsgHdrs {
  const value = headers();
  value.set("ce-specversion", "1.0");
  value.set("ce-source", owner.source);
  value.set("ce-id", id);
  value.set("ce-type", `${owner.eventTypePrefix}.${suffix}`);
  value.set("ce-time", new Date(message.info.timestampNanos / 1_000_000).toISOString());
  value.set("ce-reason", reason);
  value.set("ce-originalsubject", message.subject);
  value.set("ce-consumer", message.info.consumer);
  // Preserve every original CloudEvent value, including ambiguous repeats. Replay
  // must not silently turn quarantined invalid metadata into a valid occurrence.
  for (const key of copyOriginal ? (message.headers?.keys() ?? []) : []) {
    if (key.toLowerCase().startsWith("ce-")) {
      for (const original of message.headers?.values(key) ?? [])
        value.append(`original-${key}`, original);
    }
  }
  value.set("Nats-Msg-Id", id);
  value.set("Nats-Expected-Stream", owner.stream);
  for (const key of copyOriginal ? ["traceparent", "tracestate"] : []) {
    const traceValue = message.headers?.get(key);
    if (traceValue && traceValue.length <= 512) value.set(key, traceValue);
  }
  return value;
}
function wireBytes(record: QuarantineRecord) {
  return record.data.byteLength + Buffer.byteLength(record.headers.toString());
}
class QuarantineCapacityError extends Error {}
const cannotFit = () =>
  new QuarantineCapacityError("Quarantine message limit cannot accommodate its durable envelope");

/**
 * Pure planning of the existing single-record/chunk-and-manifest wire protocol.
 * All records fit the supplied complete wire limit before any publication begins.
 * The application owns clients, stream retention, publication/recovery, retries,
 * interruption and acknowledgement. Receipts must follow record order.
 */
export function planQuarantine(
  owner: QuarantineOwner,
  message: QuarantineInput,
  reason: string,
  limit: number
): QuarantinePlan {
  try {
    return planRecords(owner, message, reason, limit, message.data);
  } catch (cause) {
    if (!(cause instanceof QuarantineCapacityError) || !message.headers) throw cause;
    const originalHeaders = Object.fromEntries(
      message.headers.keys().map((key) => [key, message.headers?.values(key) ?? []])
    );
    const frame = new TextEncoder().encode(
      JSON.stringify({
        headers: originalHeaders,
        data: Buffer.from(message.data).toString("base64"),
      })
    );
    return planRecords(owner, message, reason, limit, frame, "original-message-v1");
  }
}

function planRecords(
  owner: QuarantineOwner,
  message: QuarantineInput,
  reason: string,
  limit: number,
  payload: Uint8Array,
  encoding?: "original-message-v1"
): QuarantinePlan {
  const id = quarantineIdentity(message);
  const single = {
    data: payload,
    headers: metadata(owner, message, reason, id, "quarantined", !encoding),
  };
  if (
    !encoding &&
    wireBytes(single) <= limit &&
    Buffer.byteLength(single.headers.toString()) <= 64 * 1024
  )
    return { records: [single] };
  const recordId = encoding ? `${id}:${encoding}` : id;
  const chunkMetadata = (index: number, count: number, size: number) => {
    const value = metadata(
      owner,
      message,
      reason,
      `${recordId}:${size}:${index}`,
      "quarantine-chunk",
      !encoding
    );
    value.set("ce-quarantineid", id);
    value.set("ce-chunkindex", String(index));
    value.set("ce-chunkcount", String(count));
    return value;
  };
  const bound = payload.byteLength;
  const overhead = Buffer.byteLength(chunkMetadata(bound, bound, bound).toString());
  if (overhead > 64 * 1024) throw cannotFit();
  const size = Math.min(128 * 1024, limit - overhead);
  if (size <= 0) throw cannotFit();
  const count = Math.ceil(payload.byteLength / size);
  if (count > 1024) throw cannotFit();
  const digest = createHash("sha256").update(payload).digest("hex");
  const encodeManifest = (sequences: readonly number[]) =>
    new TextEncoder().encode(
      JSON.stringify({
        quarantineId: id,
        chunkCount: count,
        chunkSize: size,
        totalBytes: payload.byteLength,
        sha256: digest,
        sequences,
        ...(encoding ? { encoding } : {}),
      })
    );
  const manifestHeaders = metadata(
    owner,
    message,
    reason,
    `${recordId}:manifest:${size}`,
    "quarantine-manifest",
    !encoding
  );
  if (
    wireBytes({
      data: encodeManifest(Array.from({ length: count }, () => Number.MAX_SAFE_INTEGER)),
      headers: manifestHeaders,
    }) > limit
  )
    throw cannotFit();
  return {
    records: Array.from({ length: count }, (_, index) => ({
      data: payload.subarray(index * size, (index + 1) * size),
      headers: chunkMetadata(index, count, size),
    })),
    manifest: (sequences) => {
      if (
        sequences.length !== count ||
        sequences.some((sequence) => !Number.isSafeInteger(sequence) || sequence <= 0)
      )
        throw new Error("Quarantine requires one valid sequence per chunk");
      return { data: encodeManifest(sequences), headers: manifestHeaders };
    },
  };
}

/** Verify a deduplicated receipt still points to the complete replay record. */
export function quarantineRecordMatches(
  record: QuarantineRecord,
  stored: { readonly data: Uint8Array; readonly header: MsgHdrs }
): boolean {
  if (!Buffer.from(stored.data).equals(record.data)) return false;
  const replayKeys = (value: MsgHdrs) =>
    value.keys().filter((key) => /^(?:original-)?ce-/i.test(key));
  const expected = replayKeys(record.headers);
  if (replayKeys(stored.header).length !== expected.length) return false;
  return expected.every((key) => {
    const values = record.headers.values(key);
    const actual = stored.header.values(key);
    return (
      actual.length === values.length && values.every((value, index) => value === actual[index])
    );
  });
}

const manifestSchema = z
  .object({
    quarantineId: z.string().regex(/^[a-f0-9]{64}$/),
    chunkCount: z.number().int().min(1).max(1024),
    chunkSize: z
      .number()
      .int()
      .min(1)
      .max(128 * 1024),
    totalBytes: z
      .number()
      .int()
      .min(1)
      .max(128 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    sequences: z.array(z.number().int().positive().max(Number.MAX_SAFE_INTEGER)).min(1).max(1024),
    encoding: z.literal("original-message-v1").optional(),
  })
  .strict();
const frameSchema = z
  .object({ headers: z.record(z.array(z.string()).min(1)), data: z.string() })
  .strict();
const decodeJson = (bytes: Uint8Array): unknown =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));

/**
 * Decode a single record, or a manifest with its chunks in sequence order.
 * Validate bounded metadata, lengths and SHA-256 before allocating the reassembled
 * payload. Unknown framing and malformed header/base64 data are rejected.
 */
export function decodeQuarantineReplay(
  record: QuarantineRecord,
  chunks: readonly Uint8Array[] = []
): QuarantineRecord {
  const restored = headers();
  for (const key of record.headers.keys()) {
    if (key.toLowerCase().startsWith("original-ce-")) {
      for (const value of record.headers.values(key))
        restored.append(key.slice("original-".length), value);
    }
  }
  for (const key of ["traceparent", "tracestate"])
    for (const value of record.headers.values(key)) restored.append(key, value);
  const type = record.headers.get("ce-type");
  if (type.endsWith(".quarantined") && chunks.length === 0)
    return { data: record.data, headers: restored };
  if (!type.endsWith(".quarantine-manifest") || record.data.byteLength > 64 * 1024)
    throw new Error("Invalid quarantine replay manifest");
  const manifest = manifestSchema.parse(decodeJson(record.data));
  if (
    chunks.length !== manifest.chunkCount ||
    manifest.sequences.length !== manifest.chunkCount ||
    new Set(manifest.sequences).size !== manifest.chunkCount ||
    Math.ceil(manifest.totalBytes / manifest.chunkSize) !== manifest.chunkCount
  )
    throw new Error("Invalid quarantine chunk count");
  const digest = createHash("sha256");
  for (const [index, chunk] of chunks.entries()) {
    const expected =
      index === chunks.length - 1
        ? manifest.totalBytes - index * manifest.chunkSize
        : manifest.chunkSize;
    if (chunk.byteLength !== expected) throw new Error("Invalid quarantine chunk length");
    digest.update(chunk);
  }
  if (digest.digest("hex") !== manifest.sha256) throw new Error("Invalid quarantine payload hash");
  const payload = Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    manifest.totalBytes
  );
  if (!manifest.encoding) return { data: payload, headers: restored };
  const frame = frameSchema.parse(decodeJson(payload));
  const data = Buffer.from(frame.data, "base64");
  if (data.toString("base64") !== frame.data) throw new Error("Invalid quarantine original bytes");
  const original = headers();
  for (const [key, values] of Object.entries(frame.headers))
    for (const value of values) original.append(key, value);
  const replay = headers();
  for (const key of original.keys()) {
    if (/^ce-/i.test(key) || /^(traceparent|tracestate)$/i.test(key)) {
      for (const value of original.values(key)) replay.append(key, value);
    }
  }
  return { data, headers: replay };
}

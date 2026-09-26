import { createHash } from "node:crypto";
import { headers, type JsMsg, type MsgHdrs } from "nats";

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
  suffix: string
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
  for (const key of message.headers?.keys() ?? []) {
    if (key.toLowerCase().startsWith("ce-")) {
      for (const original of message.headers?.values(key) ?? [])
        value.append(`original-${key}`, original);
    }
  }
  value.set("Nats-Msg-Id", id);
  value.set("Nats-Expected-Stream", owner.stream);
  for (const key of ["traceparent", "tracestate"]) {
    const traceValue = message.headers?.get(key);
    if (traceValue && traceValue.length <= 512) value.set(key, traceValue);
  }
  return value;
}
function wireBytes(record: QuarantineRecord) {
  return record.data.byteLength + Buffer.byteLength(record.headers.toString());
}
const cannotFit = () =>
  new Error("Quarantine message limit cannot accommodate its durable envelope");

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
  const id = quarantineIdentity(message);
  const single = {
    data: message.data,
    headers: metadata(owner, message, reason, id, "quarantined"),
  };
  if (wireBytes(single) <= limit) return { records: [single] };
  const chunkMetadata = (index: number, count: number, size: number) => {
    const value = metadata(owner, message, reason, `${id}:${size}:${index}`, "quarantine-chunk");
    value.set("ce-quarantineid", id);
    value.set("ce-chunkindex", String(index));
    value.set("ce-chunkcount", String(count));
    return value;
  };
  const bound = message.data.byteLength;
  const overhead = Buffer.byteLength(chunkMetadata(bound, bound, bound).toString());
  const size = Math.min(128 * 1024, limit - overhead);
  if (size <= 0) throw cannotFit();
  const count = Math.ceil(message.data.byteLength / size);
  if (count > 1024) throw cannotFit();
  const digest = createHash("sha256").update(message.data).digest("hex");
  const encodeManifest = (sequences: readonly number[]) =>
    new TextEncoder().encode(
      JSON.stringify({
        quarantineId: id,
        chunkCount: count,
        chunkSize: size,
        totalBytes: message.data.byteLength,
        sha256: digest,
        sequences,
      })
    );
  const manifestHeaders = metadata(
    owner,
    message,
    reason,
    `${id}:manifest:${size}`,
    "quarantine-manifest"
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
      data: message.data.subarray(index * size, (index + 1) * size),
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

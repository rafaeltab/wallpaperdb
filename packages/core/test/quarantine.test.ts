import { createHash } from "node:crypto";
import { headers } from "nats";
import { expect, it } from "vitest";
import {
  planQuarantine,
  quarantineRecordMatches,
  decodeQuarantineReplay,
} from "../src/quarantine/index.js";

const options = {
  stream: "OWNER_QUARANTINE",
  source: "https://wallpaperdb/owner",
  eventTypePrefix: "owner.upload",
};
const original = () => {
  const metadata = headers();
  metadata.set("ce-id", "original-occurrence");
  metadata.set("ce-source", "https://wallpaperdb/original");
  metadata.set("traceparent", "trace");
  return {
    subject: "wallpaper.uploaded",
    data: new TextEncoder().encode("original bytes"),
    headers: metadata,
    info: {
      domain: "domain",
      account_hash: "account",
      stream: "WALLPAPER",
      consumer: "owner",
      streamSequence: 4,
      timestampNanos: 1767225600000000000,
    },
  };
};
it("retains original bytes, binary metadata and deterministic occurrence identity", () => {
  const input = original();
  const plan = planQuarantine(options, input, "invalid", 2048);
  expect(plan.manifest).toBeUndefined();
  expect(plan.records).toHaveLength(1);
  const record = plan.records[0];
  expect(record?.data).toEqual(input.data);
  expect(record?.headers.get("original-ce-id")).toBe("original-occurrence");
  expect(record?.headers.get("original-ce-source")).toBe("https://wallpaperdb/original");
  expect(record?.headers.get("ce-type")).toBe("owner.upload.quarantined");
  expect(record?.headers.get("Nats-Expected-Stream")).toBe(options.stream);
  expect(record?.headers.get("ce-id")).toBe(
    "d134487604f23ea5475493667c49b5b673a77bb44317978adc0ec3b85a389104"
  );
  expect(planQuarantine(options, input, "invalid", 2048)).toEqual(plan);
});
it("fits every chunk and manifest, reproduces bytes, and checks receipt sequence cardinality", () => {
  const input = { ...original(), data: new Uint8Array(32000).fill(241) };
  const plan = planQuarantine(options, input, "invalid", 2048);
  expect(plan.records.length).toBeGreaterThan(1);
  expect(Buffer.concat(plan.records.map((record) => Buffer.from(record.data)))).toEqual(
    Buffer.from(input.data)
  );
  const sequences = plan.records.map((_record, index) => index + 5);
  const manifest = plan.manifest?.(sequences);
  expect(manifest).toBeDefined();
  if (!manifest) throw new Error("Missing completion record");
  expect(JSON.parse(new TextDecoder().decode(manifest.data))).toMatchObject({
    totalBytes: input.data.length,
    chunkCount: plan.records.length,
    sequences,
    sha256: createHash("sha256").update(input.data).digest("hex"),
  });
  for (const record of [...plan.records, manifest])
    expect(
      record.data.byteLength + Buffer.byteLength(record.headers.toString())
    ).toBeLessThanOrEqual(2048);
  expect(() => plan.manifest?.([])).toThrow("sequence");
});
it.each([0, 100, 800])("refuses a complete handoff that cannot fit %s bytes", (limit) => {
  expect(() =>
    planQuarantine(options, { ...original(), data: new Uint8Array(1024 * 1024) }, "invalid", limit)
  ).toThrow();
});
it("preserves repeated and extended original CloudEvent metadata for replay", () => {
  const input = original();
  input.headers.append("ce-source", "conflicting-source");
  input.headers.set("ce-customextension", "value");
  const record = planQuarantine(options, input, "invalid", 2048).records[0];
  expect(record?.headers.values("original-ce-source")).toEqual([
    "https://wallpaperdb/original",
    "conflicting-source",
  ]);
  expect(record?.headers.get("original-ce-customextension")).toBe("value");
});
it("bounds chunks and does not copy oversized trace diagnostics into the wire envelope", () => {
  const input = original();
  input.headers.set("traceparent", "a".repeat(513));
  const plan = planQuarantine(options, input, "invalid", 2048);
  expect(plan.records[0]?.headers.get("traceparent")).toBe("");
  expect(() =>
    planQuarantine(options, { ...input, data: new Uint8Array(2 * 1024 * 1024) }, "invalid", 1100)
  ).toThrow();
});

it("does not accept a deduplicated receipt that has lost original header values", () => {
  const input = original();
  input.headers.append("ce-source", "conflicting");
  const record = planQuarantine(options, input, "invalid", 2048).records[0];
  const stored = planQuarantine(options, input, "invalid", 2048).records[0];
  if (!record || !stored) throw new Error("Missing record");
  expect(quarantineRecordMatches(record, { header: stored.headers, data: stored.data })).toBe(true);
  stored.headers.set("Nats-Msg-Id", "different-storage-operation");
  expect(quarantineRecordMatches(record, { header: stored.headers, data: stored.data })).toBe(true);
  stored.headers.set("original-ce-source", "https://wallpaperdb/original");
  expect(quarantineRecordMatches(record, { header: stored.headers, data: stored.data })).toBe(
    false
  );
  expect(
    quarantineRecordMatches(record, { header: record.headers, data: new Uint8Array([0]) })
  ).toBe(false);
});

it("can quarantine broker-accepted input when original headers nearly fill the wire limit", () => {
  const input = original();
  const limit = 4096;
  input.headers.set("ce-customextension", "");
  const remaining = limit - input.data.byteLength - Buffer.byteLength(input.headers.toString()) - 1;
  input.headers.set("ce-customextension", "x".repeat(remaining));
  expect(input.data.byteLength + Buffer.byteLength(input.headers.toString())).toBeLessThanOrEqual(
    limit
  );
  const plan = planQuarantine(options, input, "invalid", limit);
  const manifest = plan.manifest?.(plan.records.map((_value, index) => index + 1));
  if (!manifest) throw new Error("Missing framed manifest");
  const evidence = JSON.parse(new TextDecoder().decode(manifest.data));
  expect(evidence.encoding).toBe("original-message-v1");
  for (const record of [...plan.records, manifest]) {
    expect(
      record.data.byteLength + Buffer.byteLength(record.headers.toString())
    ).toBeLessThanOrEqual(limit);
    expect(record.headers.get("ce-id")).toContain(":original-message-v1:");
  }
  const replay = decodeQuarantineReplay(
    manifest,
    plan.records.map((record) => record.data)
  );
  expect(Buffer.from(replay.data)).toEqual(Buffer.from(input.data));
  for (const key of input.headers.keys())
    expect(replay.headers.values(key)).toEqual(input.headers.values(key));
});

it("decodes legacy single records and raw chunk manifests without changing their replay bytes", () => {
  for (const size of [15, 32000]) {
    const input = { ...original(), data: new Uint8Array(size).fill(255) };
    const plan = planQuarantine(options, input, "invalid", 2048);
    const record =
      plan.manifest?.(plan.records.map((_value, index) => index + 1)) ?? plan.records[0];
    if (!record) throw new Error("Missing quarantine record");
    const replay = decodeQuarantineReplay(
      record,
      plan.manifest ? plan.records.map((part) => part.data) : []
    );
    expect(Buffer.from(replay.data)).toEqual(Buffer.from(input.data));
    expect(replay.headers.values("ce-source")).toEqual(input.headers.values("ce-source"));
  }
});
function replayFixture(frame: unknown, overrides: Record<string, unknown> = {}) {
  const body = new TextEncoder().encode(JSON.stringify(frame));
  const metadata = headers();
  metadata.set("ce-type", "owner.upload.quarantine-manifest");
  const manifest = {
    quarantineId: "a".repeat(64),
    chunkCount: 1,
    chunkSize: body.length,
    totalBytes: body.length,
    sha256: createHash("sha256").update(body).digest("hex"),
    sequences: [1],
    encoding: "original-message-v1",
    ...overrides,
  };
  return {
    record: { headers: metadata, data: new TextEncoder().encode(JSON.stringify(manifest)) },
    chunks: [body],
  };
}
it.each([
  { encoding: "future-version" },
  { chunkCount: 1025 },
  { totalBytes: 128 * 1024 * 1024 + 1 },
  { chunkSize: 128 * 1024 + 1 },
  { chunkCount: 2 },
  { sequences: [] },
  { sequences: [1, 1] },
  { sha256: "0".repeat(64) },
])("rejects invalid replay metadata %j before accepting bytes", (override) => {
  const fixture = replayFixture({ headers: {}, data: "" }, override);
  expect(() => decodeQuarantineReplay(fixture.record, fixture.chunks)).toThrow();
});
it.each([
  { headers: { "ce-id": "not-an-array" }, data: "" },
  { headers: { "ce-id": [8] }, data: "" },
  { headers: { "ce-id": [] }, data: "" },
  { headers: { "bad name": ["value"] }, data: "" },
  { headers: {}, data: "$invalid-base64" },
])("rejects malformed replay envelopes %j", (frame) => {
  const fixture = replayFixture(frame);
  expect(() => decodeQuarantineReplay(fixture.record, fixture.chunks)).toThrow();
});
it("rejects wrong chunk lengths and missing manifests", () => {
  const fixture = replayFixture({ headers: {}, data: "" });
  expect(() => decodeQuarantineReplay(fixture.record, [new Uint8Array(1)])).toThrow("length");
  expect(() => decodeQuarantineReplay({ data: new Uint8Array(), headers: headers() })).toThrow(
    "manifest"
  );
});

it("archives publication controls but excludes them from replay headers", () => {
  const fixture = replayFixture({
    headers: {
      "ce-id": ["occurrence"],
      "ce-source": ["https://wallpaperdb/original"],
      traceparent: ["trace"],
      "Nats-Msg-Id": ["old-publication"],
      "Nats-Expected-Stream": ["old-stream"],
      "Nats-Expected-Last-Sequence": ["1"],
    },
    data: Buffer.from("original bytes").toString("base64"),
  });
  const replay = decodeQuarantineReplay(fixture.record, fixture.chunks);
  expect(replay.headers.get("ce-id")).toBe("occurrence");
  expect(replay.headers.get("traceparent")).toBe("trace");
  expect(replay.headers.keys().some((key) => key.toLowerCase().startsWith("nats-"))).toBe(false);
});

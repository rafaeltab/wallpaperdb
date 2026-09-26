import { headers } from "nats";
import { expect, it } from "vitest";
import { z } from "zod";
import { reconcileEventMetadata } from "../src/envelope/index.js";

const schema = z.object({
  specversion: z.literal("1.0"),
  source: z.string().min(1),
  id: z.string().min(1),
  type: z.string().min(1),
  time: z.string().datetime(),
  correlationid: z.string().optional(),
  causationid: z.string().optional(),
  causationsource: z.string().optional(),
});
const metadata = {
  specversion: "1.0",
  source: "producer",
  id: "occurrence",
  type: "fact",
  time: "2026-01-01T00:00:00.000Z",
};
const event = { eventId: metadata.id, eventType: metadata.type, timestamp: metadata.time };
const decode = (value: unknown) => schema.safeParse(value).data;
const binary = () => {
  const result = headers();
  for (const [key, value] of Object.entries(metadata)) result.set(`ce-${key}`, value);
  return result;
};
it("preserves absent legacy metadata and accepted caller-decoded metadata", () => {
  expect(reconcileEventMetadata(event, undefined, event, decode)).toEqual({
    valid: true,
    value: undefined,
  });
  expect(reconcileEventMetadata(metadata, undefined, event, decode)).toEqual({
    valid: true,
    value: metadata,
  });
  expect(reconcileEventMetadata(event, binary(), event, decode)).toEqual({
    valid: true,
    value: metadata,
  });
  expect(reconcileEventMetadata(metadata, binary(), event, decode)).toEqual({
    valid: true,
    value: metadata,
  });
});
it("keeps schema policy and normalized comparison under the supplied decoder", () => {
  const strict = (value: unknown) =>
    schema.extend({ source: z.string().url() }).safeParse(value).data;
  expect(reconcileEventMetadata(metadata, undefined, event, strict)).toEqual({ valid: false });
  const normalized = (value: unknown) =>
    schema.extend({ time: z.string().transform(() => metadata.time) }).safeParse(value).data;
  expect(
    reconcileEventMetadata(
      { ...metadata, time: "caller-normalized-value" },
      binary(),
      event,
      normalized
    )
  ).toEqual({ valid: true, value: metadata });
});
it.each(["id", "type", "time"])("rejects a structured %s inconsistent with the event", (key) => {
  expect(
    reconcileEventMetadata(
      { ...metadata, [key]: key === "time" ? "2026-01-02T00:00:00.000Z" : "other" },
      undefined,
      event,
      decode
    )
  ).toEqual({ valid: false });
});
it.each([
  "specversion",
  "source",
  "id",
  "type",
  "time",
  "correlationid",
  "causationid",
  "causationsource",
])("rejects ambiguous or incomplete binary %s", (key) => {
  const value = binary();
  value.append(`ce-${key}`, "conflicting");
  if (!Object.hasOwn(metadata, key)) value.append(`ce-${key}`, "second");
  expect(reconcileEventMetadata(event, value, event, decode)).toEqual({ valid: false });
});
it.each([
  "source",
  "correlationid",
  "causationid",
  "causationsource",
])("rejects disagreeing or missing %s across representations", (key) => {
  expect(
    reconcileEventMetadata({ ...metadata, [key]: "structured" }, binary(), event, decode)
  ).toEqual({ valid: false });
});
it("rejects malformed structured and partial binary envelopes", () => {
  expect(reconcileEventMetadata({ specversion: "0.3" }, undefined, event, decode)).toEqual({
    valid: false,
  });
  const value = headers();
  value.set("ce-id", "alone");
  expect(reconcileEventMetadata(event, value, event, decode)).toEqual({ valid: false });
});

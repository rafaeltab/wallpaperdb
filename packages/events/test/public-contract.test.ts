import { describe, expect, it } from "vitest";
import * as events from "../src/index.js";

describe("shared event contracts", () => {
  it("does not expose broker runners that bypass application-owned delivery guarantees", () => {
    expect(events).not.toHaveProperty("BaseEventConsumer");
    expect(events).not.toHaveProperty("BaseEventPublisher");
  });
});

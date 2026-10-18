import { expect, it, vi } from "vitest";
import { TelemetryExportTransport } from "../src/telemetry/index.js";

it("preserves export completion when the local diagnostic output throws", async () => {
  const transport = new TelemetryExportTransport();
  const exporter = transport.monitor({
    export(_items: readonly unknown[], callback: (result: { code: number }) => void) {
      callback({ code: 1 });
    },
  });
  const completion = vi.fn();
  const write = vi.spyOn(process.stderr, "write").mockImplementation(() => {
    throw new Error("Local diagnostic output unavailable");
  });
  try {
    expect(() => exporter.export([], completion)).not.toThrow();
    expect(completion).toHaveBeenCalledWith({ code: 1 });
  } finally {
    write.mockRestore();
    await transport.close();
  }
});

it("does not add diagnostic output while stderr is backpressured", async () => {
  const transport = new TelemetryExportTransport();
  const exporter = transport.monitor({
    export(_items: readonly unknown[], callback: (result: { code: number }) => void) {
      callback({ code: 1 });
    },
  });
  const draining = vi.spyOn(process.stderr, "writableNeedDrain", "get").mockReturnValue(true);
  const write = vi.spyOn(process.stderr, "write").mockReturnValue(false);
  try {
    exporter.export([], () => undefined);
    expect(write).not.toHaveBeenCalled();
  } finally {
    write.mockRestore();
    draining.mockRestore();
    await transport.close();
  }
});

import { expect, it, vi } from "vitest";
import { TelemetryExportTransport } from "../src/telemetry/index.js";

it("reports recovery only after every failing exporter recovers", async () => {
  const transport = new TelemetryExportTransport();
  const signal = () => {
    let code = 1;
    return {
      exporter: transport.monitor({
        export(_items: readonly unknown[], callback: (result: { code: number }) => void) {
          callback({ code });
        },
      }),
      recover() {
        code = 0;
      },
    };
  };
  const traces = signal();
  const logs = signal();
  const metrics = signal();
  metrics.recover();
  const now = vi.spyOn(Date, "now").mockReturnValue(100_000);
  const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  const completed = vi.fn();
  try {
    traces.exporter.export([], completed);
    logs.exporter.export([], completed);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenLastCalledWith(
      "telemetry export unavailable; bounded best-effort export\n"
    );
    now.mockReturnValue(130_001);
    metrics.exporter.export([], completed);
    traces.recover();
    traces.exporter.export([], completed);
    expect(write).toHaveBeenCalledTimes(1);
    logs.recover();
    logs.exporter.export([], completed);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith(
      "telemetry export recovered; bounded best-effort export\n"
    );
    expect(completed).toHaveBeenCalledTimes(5);
  } finally {
    write.mockRestore();
    now.mockRestore();
    await transport.close();
  }
});

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

import * as fs from "node:fs";
import { expect, it, vi } from "vitest";
import { TelemetryExportTransport } from "../src/telemetry/index.js";

vi.mock("node:fs", { spy: true });

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
  const write = vi.spyOn(fs, "write").mockImplementation((_fd, message, callback) => {
    callback(null, Buffer.byteLength(message), message);
  });
  const completed = vi.fn();
  try {
    traces.exporter.export([], completed);
    logs.exporter.export([], completed);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenLastCalledWith(
      process.stderr.fd,
      "telemetry export unavailable; bounded best-effort export\n",
      expect.any(Function)
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
      process.stderr.fd,
      "telemetry export recovered; bounded best-effort export\n",
      expect.any(Function)
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
  const write = vi.spyOn(fs, "write").mockImplementation(() => {
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
  const write = vi.spyOn(fs, "write").mockImplementation(() => undefined);
  try {
    exporter.export([], () => undefined);
    expect(write).not.toHaveBeenCalled();
  } finally {
    write.mockRestore();
    draining.mockRestore();
    await transport.close();
  }
});

it("bounds pending diagnostics across transports without delaying export completion or close", async () => {
  const transports = [new TelemetryExportTransport(), new TelemetryExportTransport()];
  const exporters = transports.map((transport) =>
    transport.monitor({
      export(_items: readonly unknown[], callback: (result: { code: number }) => void) {
        callback({ code: 1 });
      },
    })
  );
  const now = vi.spyOn(Date, "now").mockReturnValue(100_000);
  const write = vi.spyOn(fs, "write").mockImplementation(() => undefined);
  const completion = vi.fn();
  try {
    exporters[0]?.export([], completion);
    now.mockReturnValue(130_001);
    exporters[0]?.export([], completion);
    exporters[1]?.export([], completion);
    expect(write).toHaveBeenCalledTimes(1);
    expect(completion).toHaveBeenCalledTimes(3);
    await transports[0]?.close();

    // The OS callback may arrive after the transport closes. It must release the
    // shared slot even on error, without a retry or a recursive diagnostic.
    const pending = write.mock.calls[0];
    expect(pending).toBeDefined();
    await new Promise<void>((resolve) => setImmediate(resolve));
    pending?.[2](Object.assign(new Error("Broken pipe"), { code: "EPIPE" }), 0, pending[1]);
    expect(write).toHaveBeenCalledTimes(1);
    now.mockReturnValue(160_002);
    exporters[1]?.export([], completion);
    expect(write).toHaveBeenCalledTimes(2);
    const partial = write.mock.calls[1];
    partial?.[2](null, 1, partial[1]);
    expect(write).toHaveBeenCalledTimes(2);
    await transports[1]?.close();
    now.mockReturnValue(190_003);
    exporters[1]?.export([], completion);
    expect(completion).toHaveBeenCalledTimes(5);
    expect(write).toHaveBeenCalledTimes(2);
  } finally {
    for (const [_fd, message, callback] of write.mock.calls) callback(null, 0, message);
    write.mockRestore();
    now.mockRestore();
    for (const transport of transports) await transport.close();
  }
});

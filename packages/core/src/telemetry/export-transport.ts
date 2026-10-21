import { Resolver, type LookupAddress } from "node:dns";
import { readFileSync, write } from "node:fs";
import type { Agent } from "node:http";
import { isIP, Socket, type LookupFunction } from "node:net";
import type { Duplex } from "node:stream";

export const telemetryExportTimeoutMillis = 1000;
// Reserve half the export budget for connecting and receiving a response, including
// when one DNS family succeeds and the other must be cancelled.
const dnsTimeoutMillis = telemetryExportTimeoutMillis / 2;
export const telemetryBatchOptions = {
  maxQueueSize: 256,
  maxExportBatchSize: 64,
  exportTimeoutMillis: telemetryExportTimeoutMillis,
};

// Share one in-flight diagnostic across transports. Drop output rather than queue
// more filesystem work if stderr stalls. The callback owns no transport resources.
let diagnosticPending = false;

function writeDiagnostic(message: string): void {
  if (diagnosticPending) return;
  try {
    if (process.stderr.writableNeedDrain || process.stderr.destroyed) return;
    diagnosticPending = true;
    // Borrow stderr's descriptor without using its shared Writable. Asynchronous
    // failures stay in this callback; application stream errors keep their owner.
    // Never close the descriptor, retry partial output, or report write failures.
    write(process.stderr.fd, message, () => {
      diagnosticPending = false;
    });
  } catch {
    diagnosticPending = false;
    // Diagnostic output cannot prevent exporter completion or application cleanup.
  }
}

function hostsFile(): Map<string, LookupAddress[]> {
  const hosts = new Map<string, LookupAddress[]>();
  try {
    // Read once during startup, never on an export or application request.
    for (const line of readFileSync("/etc/hosts", "utf8").split("\n")) {
      const [address, ...names] = line.split("#")[0]?.trim().split(/\s+/) ?? [];
      if (!address || !isIP(address)) continue;
      for (const name of names) {
        const entries = hosts.get(name.toLowerCase()) ?? [];
        entries.push({ address, family: isIP(address) });
        hosts.set(name.toLowerCase(), entries);
      }
    }
  } catch {
    // DNS and IP endpoints still work when the hosts file is unavailable.
  }
  return hosts;
}

/** Owns exporter-only DNS, sockets and diagnostics. Does not patch application networking. */
export class TelemetryExportTransport {
  private readonly hosts = hostsFile();
  private readonly agents = new Map<string, Promise<Agent>>();
  private readonly sockets = new Set<Duplex>();
  private readonly resolvers = new Set<Resolver>();
  private readonly failedExporters = new Set<symbol>();
  private closed = false;
  private nextDiagnostic = 0;
  private unavailable = false;

  readonly options = {
    timeoutMillis: telemetryExportTimeoutMillis,
    concurrencyLimit: 1,
    httpAgentOptions: (protocol: string) => this.agent(protocol),
  };

  /** Keep exporter protocol and serialization in the installed OTLP SDK. */
  monitor<T extends { export(items: never, callback: (result: { code: number }) => void): void }>(
    exporter: T
  ): T {
    const signal = Symbol();
    const send = exporter.export.bind(exporter);
    exporter.export = (items, callback) =>
      send(items, (result) => {
        this.report(signal, result.code === 0);
        callback(result);
      });
    return exporter;
  }

  private report(signal: symbol, success: boolean): void {
    if (this.closed) return;
    if (success) this.failedExporters.delete(signal);
    else this.failedExporters.add(signal);
    const recovered = success && this.unavailable && this.failedExporters.size === 0;
    if (!success) this.unavailable = true;
    if ((!success || recovered) && Date.now() >= this.nextDiagnostic) {
      this.nextDiagnostic = Date.now() + 30_000;
      // Never send exporter failures back through the telemetry logger. No endpoint,
      // credentials, payload, collector response or vendor error reaches stderr.
      writeDiagnostic(
        `telemetry export ${success ? "recovered" : "unavailable"}; bounded best-effort export\n`
      );
      if (success) this.unavailable = false;
    }
  }

  private readonly lookup: LookupFunction = (hostname, options, callback) => {
    const family = options.family === 4 || options.family === 6 ? options.family : 0;
    const finish = (error: Error | null, addresses: LookupAddress[]) => {
      const matching = addresses.filter((address) => !family || address.family === family);
      const first = matching[0];
      if (!first) callback(error ?? new Error("Telemetry DNS returned no addresses"), []);
      else if (options.all) callback(null, matching);
      else callback(null, first.address, first.family);
    };
    const local = this.hosts.get(hostname.toLowerCase());
    if (local) {
      queueMicrotask(() => finish(null, local));
      return;
    }
    const resolver = new Resolver({ timeout: dnsTimeoutMillis, tries: 1 });
    this.resolvers.add(resolver);
    const addresses: LookupAddress[] = [];
    let pending = family ? 1 : 2;
    let failure: Error | null = null;
    const deadline = setTimeout(() => resolver.cancel(), dnsTimeoutMillis);
    const resolved = (version: number) => (error: Error | null, records: string[]) => {
      if (error) failure = error;
      else addresses.push(...records.map((address) => ({ address, family: version })));
      if (--pending !== 0) return;
      clearTimeout(deadline);
      this.resolvers.delete(resolver);
      finish(failure, addresses);
    };
    // c-ares performs network DNS without getaddrinfo or the shared libuv pool.
    // Never fall back to dns.lookup, including after a resolver error or deadline.
    if (family !== 6) resolver.resolve4(hostname, resolved(4));
    if (family !== 4) resolver.resolve6(hostname, resolved(6));
  };

  private agent(protocol: string): Promise<Agent> {
    const existing = this.agents.get(protocol);
    if (existing) return existing;
    const agent = this.createAgent(protocol);
    this.agents.set(protocol, agent);
    return agent;
  }

  private async createAgent(protocol: string): Promise<Agent> {
    // Preserve early initialization: load HTTP only when the exporter needs it.
    const AgentConstructor: typeof Agent = (
      await (protocol === "https:" ? import("node:https") : import("node:http"))
    ).Agent;
    const owner = this;
    return new (class extends AgentConstructor {
      override createConnection(...args: Parameters<Agent["createConnection"]>) {
        if (owner.closed) {
          const socket = new Socket();
          queueMicrotask(() => socket.destroy(new Error("Telemetry transport closed")));
          return socket;
        }
        const socket = super.createConnection(...args);
        if (socket) owner.ownSocket(socket);
        return socket;
      }
    })({ keepAlive: false, maxSockets: 3, maxTotalSockets: 3, lookup: this.lookup });
  }

  private ownSocket(socket: Duplex): void {
    this.sockets.add(socket);
    // An absolute deadline also bounds a peer streaming a response indefinitely.
    const deadline = setTimeout(
      () => socket.destroy(new Error("Telemetry export deadline exceeded")),
      telemetryExportTimeoutMillis
    );
    socket.once("close", () => {
      clearTimeout(deadline);
      this.sockets.delete(socket);
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const resolver of this.resolvers) resolver.cancel();
    await Promise.all(
      [...this.sockets].map(
        (socket) =>
          new Promise<void>((resolve) => {
            socket.once("close", resolve);
            socket.destroy();
          })
      )
    );
    for (const agent of await Promise.all(this.agents.values())) agent.destroy();
  }
}

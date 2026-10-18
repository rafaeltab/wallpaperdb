import { createHook } from "node:async_hooks";
import { createSocket } from "node:dgram";
import { getServers } from "node:dns";
import { createServer, get, type Agent } from "node:http";
import { expect, it, vi } from "vitest";
import { TelemetryExportTransport } from "../src/telemetry/index.js";

const resolverFixture = vi.hoisted(() => ({ server: "" }));
vi.mock("node:dns", async (original) => {
  const dns = await original<typeof import("node:dns")>();
  return {
    ...dns,
    Resolver: class extends dns.Resolver {
      constructor(options?: ConstructorParameters<typeof dns.Resolver>[0]) {
        super(options);
        // Only point this external resolver instance at the owned DNS fixture.
        this.setServers([resolverFixture.server]);
      }
    },
  };
});

function request(agent: Agent, url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    get(url, { agent }, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode ?? 0));
      response.once("error", reject);
    }).once("error", reject);
  });
}

it("bounds DNS work, uses a resolved family when its peer stalls and recovers without system lookups", async () => {
  const dns = createSocket("udp4");
  let healthy = false;
  let dropIpv6 = false;
  let queries = 0;
  dns.on("message", (query, peer) => {
    queries++;
    if (!healthy) return;
    let end = 12;
    while (query[end] !== 0) end += (query[end] ?? 0) + 1;
    end += 5;
    const header = Buffer.from(query.subarray(0, 12));
    const ipv4 = query.readUInt16BE(end - 4) === 1;
    if (!ipv4 && dropIpv6) return;
    header.writeUInt16BE(0x8180, 2);
    header.writeUInt16BE(ipv4 ? 1 : 0, 6);
    header.writeUInt32BE(0, 8);
    const answer = Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 0, 0, 4, 127, 0, 0, 1]);
    dns.send(
      Buffer.concat([header, query.subarray(12, end), ...(ipv4 ? [answer] : [])]),
      peer.port,
      peer.address
    );
  });
  await new Promise<void>((resolve) => dns.bind(0, "127.0.0.1", resolve));
  const originalServers = getServers();
  resolverFixture.server = `127.0.0.1:${dns.address().port}`;
  const collector = createServer((incoming, response) => {
    expect(incoming.headers.host).toMatch(/^(collector\.test|localhost):/);
    response.end();
  });
  await new Promise<void>((resolve) => collector.listen(0, "127.0.0.1", resolve));
  const address = collector.address();
  if (!address || typeof address === "string") throw new Error("Missing collector address");
  let systemLookups = 0;
  const hook = createHook({
    init(_id, type) {
      if (type === "GETADDRINFOREQWRAP") systemLookups++;
    },
  }).enable();
  const transport = new TelemetryExportTransport();
  try {
    const agent = await transport.options.httpAgentOptions("http:");
    const endpoint = `http://collector.test:${address.port}`;
    await expect(request(agent, endpoint)).rejects.toThrow();
    expect(queries).toBeGreaterThan(0);
    healthy = true;
    await expect(request(agent, endpoint)).resolves.toBe(200);
    const beforeHosts = queries;
    await expect(request(agent, `http://localhost:${address.port}`)).resolves.toBe(200);
    expect(queries).toBe(beforeHosts);
    expect(systemLookups).toBe(0);
    expect(getServers()).toEqual(originalServers);
    dropIpv6 = true;
    await expect(request(agent, endpoint)).resolves.toBe(200);
    const beforeClose = queries;
    healthy = false;
    const closedRequest = request(agent, endpoint).catch(() => "closed");
    await vi.waitFor(() => expect(queries).toBeGreaterThan(beforeClose));
    const started = performance.now();
    await transport.close();
    await expect(closedRequest).resolves.toBe("closed");
    expect(performance.now() - started).toBeLessThan(500);
    expect(systemLookups).toBe(0);
  } finally {
    hook.disable();
    await transport.close();
    dns.close();
    collector.closeAllConnections();
    await new Promise<void>((resolve) => collector.close(() => resolve()));
  }
});

import { appendFileSync, writeFileSync } from 'node:fs';
import { Agent } from 'node:http';
import type { Socket } from 'node:net';
import { threadId } from 'node:worker_threads';
import type { Client } from '@opensearch-project/opensearch';
import { afterAll, vi } from 'vitest';

type SocketObservation = {
  closed: Promise<void>;
  localPort: number | undefined;
  remotePort: number | undefined;
};
type ClientObservation = {
  id: number;
  attempted: boolean;
  returned: boolean;
  failed: boolean;
  agents: Set<Agent>;
  sockets: Map<Socket, SocketObservation>;
};
const observed = vi.hoisted(() => ({
  clients: new Map<Client, ClientObservation>(),
  applications: new Map<
    object,
    {
      id: number;
      disposed: boolean;
      failed: boolean;
      cleanup: () => Promise<void>;
    }
  >(),
  failed: false,
}));

vi.mock('@opensearch-project/opensearch', async (original) => {
  const sdk = await original<typeof import('@opensearch-project/opensearch')>();
  return {
    ...sdk,
    Client: class extends sdk.Client {
      constructor(...args: ConstructorParameters<typeof sdk.Client>) {
        const started = performance.now();
        super(...args);
        const entry: ClientObservation = {
          id: observed.clients.size + 1,
          attempted: false,
          returned: false,
          failed: false,
          agents: new Set(),
          sockets: new Map(),
        };
        observed.clients.set(this, entry);
        try {
          capture(this, entry);
          record({
            event: 'sdk-created',
            client: entry.id,
            phase: 'created',
            seconds: (performance.now() - started) / 1000,
          });
        } catch (error) {
          entry.failed = true;
          observed.failed = true;
          record({ event: 'observation-failure', failed: true });
          for (const agent of entry.agents) agent.destroy();
          throw error;
        }
      }
      override close(): Promise<void>;
      override close(callback: (...args: unknown[]) => void): void;
      override close(callback?: (...args: unknown[]) => void): Promise<void> | void {
        const entry = observed.clients.get(this);
        if (!entry) throw new Error('Unknown owned mutation OpenSearch client');
        const started = performance.now();
        entry.attempted = true;
        const closing = (async () => {
          let observationError: unknown;
          try {
            capture(this, entry);
          } catch (error) {
            observationError = error;
          }
          // Snapshot and attach socket listeners before the real pool clears its references.
          // SDK close() without a callback calls this.close(resolve).
          await bounded(new Promise<void>((resolve) => super.close(resolve)), 2000);
          entry.returned = true;
          await bounded(
            Promise.all([...entry.sockets.values()].map((value) => value.closed)),
            1000
          );
          if (observationError) throw observationError;
          record({
            event: 'sdk-close',
            client: entry.id,
            seconds: (performance.now() - started) / 1000,
          });
        })().catch((error) => {
          entry.failed = true;
          observed.failed = true;
          record({ event: 'observation-failure', failed: true });
          throw error;
        });
        if (callback) {
          void closing.then(
            () => callback(),
            (error) => callback(error)
          );
          return;
        }
        return closing;
      }
    },
  };
});

vi.mock('./search-fixture.js', async (original) => {
  const fixture = await original<typeof import('./search-fixture.js')>();
  return {
    ...fixture,
    acquireSearchFixture: async (...args: Parameters<typeof fixture.acquireSearchFixture>) => {
      const started = performance.now();
      const application = await fixture.acquireSearchFixture(...args);
      const entry = {
        id: observed.applications.size + 1,
        disposed: false,
        failed: false,
        cleanup: () => application.dispose(),
      };
      observed.applications.set(application.adapter, entry);
      record({
        event: 'application-acquired',
        application: entry.id,
        seconds: (performance.now() - started) / 1000,
      });
      return {
        ...application,
        dispose: async () => {
          const started = performance.now();
          try {
            await bounded(application.dispose(), 3000);
            entry.disposed = true;
            record({
              event: 'application-fixture-disposed',
              application: entry.id,
              phase: 'disposed',
              seconds: (performance.now() - started) / 1000,
            });
          } catch (error) {
            entry.failed = true;
            observed.failed = true;
            record({ event: 'observation-failure', failed: true });
            throw error;
          }
        },
      };
    },
  };
});

let execution = 0;
const reset = process.env.WALLPAPERDB_MUTATION_OPENSEARCH_RESET;
const token = process.env.WALLPAPERDB_MUTATION_OPENSEARCH_TOKEN;
const timings = process.env.WALLPAPERDB_MUTATION_CLIENT_TIMINGS;

function record(value: object) {
  if (!timings) throw new Error('Missing owned OpenSearch observations');
  appendFileSync(
    timings,
    `${JSON.stringify({ execution, pid: process.pid, threadId, at: Date.now(), ...value })}\n`
  );
}
async function bounded<T>(value: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      value,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Owned OpenSearch disposal deadline expired')),
          ms
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function watch(entry: ClientObservation, socket: Socket) {
  if (entry.sockets.has(socket)) return;
  const closed = socket.closed
    ? Promise.resolve()
    : new Promise<void>((resolve) => socket.once('close', () => resolve()));
  entry.sockets.set(socket, {
    closed,
    localPort: socket.localPort,
    remotePort: socket.remotePort,
  });
}
function capture(client: Client, entry: ClientObservation) {
  for (const connection of client.connectionPool.connections) {
    // The pinned SDK types name _agent, but its implementation exposes agent.
    if (!('agent' in connection) || !(connection.agent instanceof Agent))
      throw new Error('Unobservable owned OpenSearch Agent');
    const agent = connection.agent;
    if (!entry.agents.has(agent)) {
      entry.agents.add(agent);
      agent.on('free', (socket: Socket) => watch(entry, socket));
    }
    for (const socket of [
      ...Object.values(agent.sockets),
      ...Object.values(agent.freeSockets),
    ].flatMap((values) => values ?? []))
      watch(entry, socket);
  }
}
async function control(path: string) {
  if (!reset || !token) throw new Error('Missing owned OpenSearch control');
  // Isolated reset includes a JVM restart capped at120s by the controller.
  // The native runner still owns the shorter stage deadline and shutdown grace.
  const recreating = path === '/reset' && (process.env.MUTATION_OPENSEARCH_ISOLATED ?? '1') === '1';
  const response = await fetch(new URL(path, reset), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(recreating ? 121000 : 6000),
  });
  if (!response.ok) {
    const error = new Error('Owned OpenSearch control rejected');
    try {
      await response.body?.cancel();
    } catch {
      // Keep the original HTTP rejection authoritative.
    }
    throw error;
  }
  return await response.text();
}
async function fail() {
  observed.failed = true;
  try {
    const file = process.env.WALLPAPERDB_MUTATION_FAILURE_FILE;
    if (file) writeFileSync(file, '{"failed":true}');
  } finally {
    try {
      await control('/failure');
    } catch {
      /* Independent receipt remains authoritative. */
    }
  }
}
try {
  execution = Number(await control('/reset'));
  if (!Number.isSafeInteger(execution) || execution < 1)
    throw new Error('Invalid OpenSearch execution');
  record({ event: 'execution-ready' });
} catch (error) {
  await fail();
  throw error;
}

// Outer hook follows the unchanged suite's inner disposal hooks.
afterAll(async () => {
  let failure: unknown;
  try {
    const clients = [...observed.clients].map(([client, entry]) => {
      capture(client, entry);
      return {
        id: entry.id,
        attempted: entry.attempted,
        returned: entry.returned,
        failed: entry.failed,
        agents: [...entry.agents].map((agent) => ({
          queued: Object.values(agent.requests).reduce((n, values) => n + (values?.length ?? 0), 0),
          sockets: [...Object.values(agent.sockets), ...Object.values(agent.freeSockets)]
            .flatMap((values) => values ?? [])
            .map((socket) => ({
              closed: socket.closed,
              destroyed: socket.destroyed,
            })),
        })),
        sockets: [...entry.sockets].map(([socket, value]) => ({
          localPort: value.localPort,
          remotePort: value.remotePort,
          closed: socket.closed,
          destroyed: socket.destroyed,
        })),
      };
    });
    const applications = [...observed.applications.values()];
    const passed =
      !observed.failed &&
      clients.length > 0 &&
      clients.length <= 1024 &&
      applications.length === 1 &&
      applications.every((value) => value.disposed && !value.failed) &&
      clients.every(
        (value) =>
          value.attempted &&
          value.returned &&
          !value.failed &&
          value.agents.length > 0 &&
          value.sockets.every((socket) => socket.closed && socket.destroyed) &&
          value.agents.every(
            (agent) =>
              agent.queued === 0 &&
              agent.sockets.every((socket) => socket.closed && socket.destroyed)
          )
      );
    record({
      event: 'disposal-audit',
      complete: true,
      passed,
      scope: 'actual-sdk-application-adapter-agents-and-sockets',
      clients,
      applications,
    });
    if (!passed) throw new Error('Owned OpenSearch client disposal audit failed');
    if (process.env.MUTATION_OPENSEARCH_DISPOSAL_FAILURE === 'after-progress' && execution >= 3)
      throw new Error('Requested OpenSearch disposal failure');
    await control(`/disposed/${execution}`);
  } catch (error) {
    failure = error;
  }
  // A rejected earlier suite hook must not skip the other actual applications/transports.
  for (const entry of observed.applications.values()) {
    if (entry.disposed) continue;
    try {
      await bounded(entry.cleanup(), 1000);
    } catch (error) {
      failure ??= error;
    }
  }
  for (const [client, entry] of observed.clients) {
    try {
      capture(client, entry);
    } catch (error) {
      failure ??= error;
    }
    for (const agent of entry.agents) {
      try {
        agent.destroy();
      } catch (error) {
        failure ??= error;
      }
    }
  }
  try {
    await bounded(
      Promise.all(
        [...observed.clients.values()].flatMap((entry) =>
          [...entry.sockets.values()].map((socket) => socket.closed)
        )
      ),
      1000
    );
  } catch (error) {
    failure ??= error;
  }
  if (failure) {
    await fail();
    throw failure;
  }
}, 10000);

import { createServer, request } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { connect } from 'node:net';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

type ContainerInfo = {
  Id: string;
  State: string;
  Labels: Record<string, string>;
};

/**
 * Forward real Docker requests, exposing only this fixture's Ryuk containers.
 * Hold the first running-container snapshot until the selected Ryuk exits.
 * Socket connections and container states come from the real daemon.
 */
export async function createDockerProxy(
  socketPath: string,
  reaperId: string,
  afterSnapshot: () => Promise<void>
) {
  const directory = await mkdtemp(join(tmpdir(), 'wallpaperdb-ryuk-'));
  const proxyPath = join(directory, 'docker.sock');
  const ownedIds = new Set([reaperId]);
  const connections = new Set<Socket>();
  let heldSnapshot = false;

  const server = createServer((incoming, outgoing) => {
    const upstream = request(
      {
        socketPath,
        path: incoming.url,
        method: incoming.method,
        headers: incoming.headers,
      },
      (response) => {
        const isList =
          incoming.method === 'GET' && /\/containers\/json(?:\?|$)/.test(incoming.url ?? '');
        const isCreate =
          incoming.method === 'POST' && /\/containers\/create(?:\?|$)/.test(incoming.url ?? '');
        if (!isList && !isCreate) {
          outgoing.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(outgoing);
          return;
        }
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', async () => {
          try {
            let body = Buffer.concat(chunks);
            if (isList && response.statusCode === 200) {
              const containers: ContainerInfo[] = JSON.parse(body.toString());
              const visible = containers.filter(
                (container) =>
                  container.Labels['org.testcontainers.ryuk'] !== 'true' ||
                  ownedIds.has(container.Id)
              );
              // The label protects the real daemon from other test runners.
              // Remove it only in this isolated client's view.
              for (const container of visible) {
                if (ownedIds.has(container.Id))
                  delete container.Labels.TESTCONTAINERS_RYUK_TEST_LABEL;
              }
              if (
                !heldSnapshot &&
                visible.some(
                  (container) => container.Id === reaperId && container.State === 'running'
                )
              ) {
                heldSnapshot = true;
                await afterSnapshot();
              }
              body = Buffer.from(JSON.stringify(visible));
            } else if (isCreate && response.statusCode === 201) {
              const created: { Id: string } = JSON.parse(body.toString());
              ownedIds.add(created.Id);
            }
            const headers = { ...response.headers };
            delete headers['transfer-encoding'];
            headers['content-length'] = String(body.length);
            outgoing.writeHead(response.statusCode ?? 502, headers);
            outgoing.end(body);
          } catch (error) {
            outgoing.writeHead(502);
            outgoing.end(String(error));
          }
        });
      }
    );
    upstream.on('error', (error) => {
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end(String(error));
    });
    outgoing.on('close', () => upstream.destroy());
    incoming.pipe(upstream);
  });
  server.on('connection', (socket) => {
    connections.add(socket);
    socket.on('close', () => connections.delete(socket));
  });
  server.on('upgrade', (incoming, downstream, head) => {
    const upstream = connect(socketPath);
    upstream.on('connect', () => {
      const headers = incoming.rawHeaders.reduce(
        (lines, header, index) => lines + (index % 2 === 0 ? `${header}: ` : `${header}\r\n`),
        ''
      );
      upstream.write(`${incoming.method} ${incoming.url} HTTP/1.1\r\n${headers}\r\n`);
      upstream.write(head);
      downstream.pipe(upstream).pipe(downstream);
    });
    upstream.on('error', () => downstream.destroy());
    downstream.on('error', () => upstream.destroy());
    downstream.on('close', () => upstream.destroy());
  });
  server.listen(proxyPath);
  await once(server, 'listening');

  return {
    host: `unix://${proxyPath}`,
    temporaryDirectory: directory,
    didHoldSnapshot: () => heldSnapshot,
    ownedIds,
    async close() {
      for (const connection of connections) connection.destroy();
      server.close();
      await once(server, 'close');
      await rm(directory, { recursive: true, force: true });
    },
  };
}

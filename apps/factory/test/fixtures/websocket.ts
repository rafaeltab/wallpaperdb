import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer } from 'ws';

/** A controlled endpoint for the installed T3 JSON RPC contract. */
export async function websocketProtocol(
  onRequest: (request: unknown, send: (value: unknown) => void, signal: AbortSignal) => void,
  onHttp?: (request: IncomingMessage, response: ServerResponse) => void
) {
  const server = createServer(
    onHttp ??
      ((_request, response) => {
        response.writeHead(404).end();
      })
  );
  const websocket = new WebSocketServer({ noServer: true, perMessageDeflate: true });
  server.on('upgrade', (request, socket, head) => {
    if (request.headers.authorization !== 'Bearer controlled-observer') {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    websocket.handleUpgrade(request, socket, head, (client) => {
      const lifetime = new AbortController();
      client.once('close', () => lifetime.abort());
      client.on('message', (data) =>
        onRequest(
          JSON.parse(data.toString()),
          (value) => client.send(JSON.stringify(value)),
          lifetime.signal
        )
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing protocol address');
  let closing: Promise<void> | undefined;
  return {
    origin: `http://127.0.0.1:${address.port}`,
    connections: () => websocket.clients.size,
    close: () =>
      (closing ??= (async () => {
        for (const client of websocket.clients) client.terminate();
        await new Promise<void>((resolve, reject) =>
          websocket.close((error) => (error ? reject(error) : resolve()))
        );
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        );
      })()),
  };
}

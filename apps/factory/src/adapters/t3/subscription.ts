import { z } from 'zod';
import WebSocket from 'ws';

interface Subscription {
  id: string;
  method: string;
  payload: object;
}
const chunk = z.object({
  _tag: z.literal('Chunk'),
  requestId: z.string(),
  values: z.array(z.unknown()),
});
const frame = z.object({ _tag: z.string() }).passthrough();

/** Acknowledgement follows durable application, so failed publication can replay.
 * Credentials stay in the upgrade headers, never in URLs. */
export async function t3Subscription(config: {
  origin: string;
  token: string;
  signal: AbortSignal;
  requests: readonly Subscription[];
  apply: (id: string, values: readonly unknown[]) => Promise<void>;
}): Promise<void> {
  config.signal.throwIfAborted();
  const url = new URL('/ws', config.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('orchestrationProtocol', '2');
  if (config.signal.aborted) return;
  const socket = new WebSocket(url, {
    headers: { Authorization: `Bearer ${config.token}` },
    maxPayload: 64 * 1024 * 1024,
    handshakeTimeout: 15_000,
  });
  await new Promise<void>((resolve, reject) => {
    let finished = false;
    let pending = Promise.resolve();
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(opening);
      config.signal.removeEventListener('abort', abort);
      socket.terminate();
      void pending.finally(() => (error ? reject(error) : resolve())).catch(reject);
    };
    const abort = () => finish();
    const opening = setTimeout(
      () => finish(new Error('T3 observer WebSocket opening timed out')),
      15_000
    );
    config.signal.addEventListener('abort', abort, { once: true });
    if (config.signal.aborted) {
      abort();
      return;
    }
    socket.addEventListener('open', () => {
      clearTimeout(opening);
      for (const request of config.requests)
        socket.send(
          JSON.stringify({
            _tag: 'Request',
            id: request.id,
            tag: request.method,
            payload: request.payload,
            headers: [],
          })
        );
    });
    socket.addEventListener('message', (event) => {
      if (finished) return;
      pending = pending.then(async () => {
        const decoded: unknown = JSON.parse(z.string().parse(event.data));
        for (const raw of Array.isArray(decoded) ? decoded : [decoded]) {
          const message = frame.parse(raw);
          if (message._tag === 'Ping') {
            socket.send(JSON.stringify({ _tag: 'Pong' }));
            continue;
          }
          if (message._tag === 'Chunk') {
            const value = chunk.parse(message);
            if (!config.requests.some((request) => request.id === value.requestId))
              throw new Error('Unknown T3 observation stream');
            await config.apply(value.requestId, value.values);
            if (!finished && socket.readyState === WebSocket.OPEN)
              socket.send(JSON.stringify({ _tag: 'Ack', requestId: value.requestId }));
          } else if (message._tag === 'Exit' || message._tag === 'Defect') {
            throw new Error('T3 observation subscription ended');
          }
        }
      });
      void pending.catch(() =>
        finish(new Error('T3 observer could not apply subscription update'))
      );
    });
    socket.addEventListener('error', () => finish(new Error('T3 observer WebSocket failed')));
    socket.on('unexpected-response', (_request, response) => {
      response.resume();
      finish(new Error(`T3 observer authentication failed: HTTP ${response.statusCode}`));
    });
    socket.addEventListener('close', () =>
      finish(config.signal.aborted ? undefined : new Error('T3 observer WebSocket disconnected'))
    );
  });
}

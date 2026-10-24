import { parentPort, workerData } from 'node:worker_threads';
import { connect } from 'nats';

// This private worker owns every SDK socket, including incomplete connection handshakes.
// Its parent serializes inspections and awaits termination on cancellation or shutdown.
const port = parentPort;
if (!port) throw new Error('NATS probe requires a worker message port');

try {
  const connection = await connect(workerData);
  port.on('message', (message: unknown) => {
    if (message !== 'inspect') return;
    connection.rtt().then(
      () => port.postMessage('healthy'),
      (cause: unknown) =>
        port.postMessage(cause instanceof Error ? cause : new Error('NATS RTT failed'))
    );
  });
  port.postMessage('connected');
} catch (cause) {
  port.postMessage(cause instanceof Error ? cause : new Error('NATS connection failed'));
}

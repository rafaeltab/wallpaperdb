import { connect } from 'nats';
import { GenericContainer, Wait } from 'testcontainers';

const container = await new GenericContainer('nats:2.10-alpine')
  .withExposedPorts(4222)
  .withWaitStrategy(Wait.forLogMessage('Server is ready'))
  .start();
const connection = await connect({
  servers: `nats://${container.getHost()}:${container.getMappedPort(4222)}`,
  reconnect: false,
});
await connection.flush();
await connection.close();
process.send?.({ containerId: container.getId() });
process.disconnect();
// Deliberately leave the container running. Ryuk must remove it on process exit.

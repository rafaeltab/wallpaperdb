import { z } from 'zod';
import { fakeV2Server } from '../index.js';

const port = z.coerce
  .number()
  .int()
  .min(1)
  .max(65535)
  .parse(process.env.FACTORY_V2_DEMO_PORT ?? 9402);
const app = fakeV2Server();
await app.listen({ host: '127.0.0.1', port });
console.log(`Fake factory v2: http://127.0.0.1:${port}/api/v2/board`);
const stop = () => {
  void app.close().catch(() => {
    process.exitCode = 1;
  });
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

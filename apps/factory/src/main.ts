import { startFactory } from './composition/index.js';
const running = await startFactory(process.env);
process.once('SIGTERM', () => {
  void running.close();
});
process.once('SIGINT', () => {
  void running.close();
});

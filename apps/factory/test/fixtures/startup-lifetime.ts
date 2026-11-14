import { startFactory } from '../../src/composition/index.js';

if (process.env.FACTORY_EXPECT_INVALID === '1') {
  try {
    const service = await startFactory(process.env);
    await service.close();
    throw new Error('Invalid retained intent was accepted');
  } catch (cause) {
    if (!(cause instanceof Error) || !('operation' in cause) || cause.operation !== 'read')
      throw cause;
    console.info('Controlled retained intent rejected');
  }
} else {
  const service = await startFactory(process.env);
  await service.close();
  console.info('Controlled service closed');
}
// Natural process exit proves that the composition released its owned workers.

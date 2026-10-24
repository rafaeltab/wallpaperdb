import { expect, it } from 'vitest';
import { OperatorNotificationHealth, recoverQuarantine } from '../src/adapters/commands/index.js';
import { withOperatorNotificationFixture } from './fixtures/operator-notification.js';

it('delivers durable operator notices to the configured HTTP destination and quarantines exhausted notification delivery until recovery', async () => {
  let status = 200;
  const received: unknown[] = [];
  let calls = 0;
  await withOperatorNotificationFixture(
    async (request, response) => {
      calls++;
      if (request.headers.authorization !== 'Bearer operator-inbox-token') {
        response.writeHead(401).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      if (status === 200) received.push(JSON.parse(Buffer.concat(chunks).toString()));
      response.writeHead(status).end();
    },
    async ({ runtime, operator, wallpaperOperator, authority }) => {
      await runtime.runPromise(OperatorNotificationHealth);
      const notice = {
        id: 'a'.repeat(64),
        kind: 'result-quarantine',
        subject: 'asset.results.user',
        reason: 'exhausted',
        context: {
          occurrence: { source: 'https://example.test/application', id: 'command-occurrence' },
          correlationId: 'workflow-1',
          traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
        },
      };
      await operator.jetstream().publish('asset.operator.notifications', JSON.stringify(notice));
      await expect
        .poll(() => received, { timeout: 3000 })
        .toEqual([{ ...notice, applicationId: 'user' }]);
      status = 503;
      await operator
        .jetstream()
        .publish('asset.operator.notifications', JSON.stringify({ ...notice, id: 'b'.repeat(64) }));
      const manager = await operator.jetstreamManager();
      await expect
        .poll(async () => (await manager.streams.info('ASSET_QUARANTINE')).state.messages, {
          timeout: 5000,
        })
        .toBe(1);
      expect(calls).toBe(4);
      const stored = await manager.streams.getMessage('ASSET_QUARANTINE', { seq: 1 });
      expect(JSON.parse(stored.string()).type).toBe('asset.notification.quarantined');
      status = 200;
      await wallpaperOperator
        .jetstream()
        .publish('asset.operator.notifications', JSON.stringify({ ...notice, id: 'c'.repeat(64) }));
      await expect.poll(() => received.length, { timeout: 3000 }).toBe(2);
      expect(
        await runtime.runPromise(OperatorNotificationHealth.use((service) => service.check()))
      ).toBe(false);
      await recoverQuarantine(operator, authority, 'user', 1);
      await expect.poll(() => received.length, { timeout: 3000 }).toBe(3);
      expect(
        await runtime.runPromise(OperatorNotificationHealth.use((service) => service.check()))
      ).toBe(true);
      await manager.consumers.delete('ASSET_OPERATIONS', 'operator_notifications');
      await expect
        .poll(
          () => runtime.runPromise(OperatorNotificationHealth.use((service) => service.check())),
          { timeout: 3000 }
        )
        .toBe(false);
      await wallpaperOperator
        .jetstream()
        .publish('asset.operator.notifications', JSON.stringify({ ...notice, id: 'd'.repeat(64) }));
      await expect.poll(() => received.length, { timeout: 3000 }).toBe(4);
      expect(
        await runtime.runPromise(OperatorNotificationHealth.use((service) => service.check()))
      ).toBe(false);
    }
  );
});

it('unwinds the HTTP listener, broker and authenticated connection when provisioning setup fails', async () => {
  const setupFailure = new Error('controlled setup failure after real broker provisioning');
  let verifyReleased: (() => Promise<void>) | undefined;
  await expect(
    withOperatorNotificationFixture(
      (_request, response) => response.end(),
      async () => {
        throw new Error('The test body must not run');
      },
      {
        afterProvision: async ({ server, operator, container }) => {
          verifyReleased = async () => {
            expect(server.listening).toBe(false);
            expect(operator.isClosed()).toBe(true);
            await expect(container.exec(['true'])).rejects.toThrow();
          };
          throw setupFailure;
        },
      }
    )
  ).rejects.toBe(setupFailure);
  expect(verifyReleased).toBeDefined();
  await verifyReleased?.();
});

it('attempts every release after teardown rejection and retains the original test and cleanup failures', async () => {
  const testFailure = new Error('controlled notification test failure');
  const cleanupFailure = new Error('controlled rejection after closing the operator connection');
  let verifyReleased: (() => Promise<void>) | undefined;
  let actual: unknown;
  try {
    await withOperatorNotificationFixture(
      (_request, response) => response.end(),
      async ({ server, operator, wallpaperOperator, container, runtime }) => {
        await runtime.runPromise(OperatorNotificationHealth);
        verifyReleased = async () => {
          expect(server.listening).toBe(false);
          expect(operator.isClosed()).toBe(true);
          expect(wallpaperOperator.isClosed()).toBe(true);
          await expect(container.exec(['true'])).rejects.toThrow();
        };
        throw testFailure;
      },
      {
        closeOperator: async (operator) => {
          await operator.close();
          throw cleanupFailure;
        },
      }
    );
  } catch (error) {
    actual = error;
  }
  expect(actual).toBeInstanceOf(AggregateError);
  if (!(actual instanceof AggregateError)) throw new Error('Expected retained failures');
  expect(actual.errors).toEqual([testFailure, cleanupFailure]);
  expect(verifyReleased).toBeDefined();
  await verifyReleased?.();
});

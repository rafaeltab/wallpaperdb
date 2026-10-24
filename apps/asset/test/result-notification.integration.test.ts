import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { connect } from 'nats';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { createOperatorInbox } from '../../../scripts/operator-inbox.mjs';
import { activateLifecycle, lifecyclePostgresLayer } from '../src/adapters/lifecycle/index.js';
import {
  protectedCommandsLayer,
  ProtectedCommandHealth,
  OperatorNotificationHealth,
  recoverQuarantine,
} from '../src/adapters/commands/index.js';
import {
  Lifecycle,
  ResultOutbox,
  lifecycleLayer,
  LifecycleFailure,
  type ResultPublication,
} from '../src/capabilities/lifecycle/index.js';
import { withOperatorNotificationFixture } from './fixtures/operator-notification.js';
import { authorityFixture } from './fixtures/authority.js';

const exec = promisify(execFile);

it('routes distinct retained result-quarantine receipts across two finite exhaustion/recovery cycles and delivers the original result', async () => {
  const releases: Array<() => Promise<unknown>> = [];
  const failures: unknown[] = [];
  try {
    const directory = await mkdtemp(join(tmpdir(), 'asset-result-inbox-'));
    releases.push(() => rm(directory, { recursive: true, force: true }));
    async function startReceiver() {
      const receiver = await createOperatorInbox({ directory, token: 'operator-inbox-token' });
      const stop = async () => {
        if (!receiver.listening) return;
        receiver.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          receiver.close((error?: Error) => (error ? reject(error) : resolve()))
        );
      };
      releases.push(stop);
      receiver.listen(0, '127.0.0.1');
      await once(receiver, 'listening');
      const address = receiver.address();
      if (!address || typeof address === 'string') throw new Error('Missing inbox address');
      return { stop, url: `http://127.0.0.1:${address.port}` };
    }
    let receiver = await startReceiver();
    let rejectHttp = true;
    let httpFailures = 0;
    await withOperatorNotificationFixture(
      async (request, response) => {
        if (rejectHttp) {
          httpFailures++;
          response.writeHead(503).end();
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const forwarded = await fetch(`${receiver.url}/events`, {
          method: 'POST',
          headers: { authorization: request.headers.authorization ?? '' },
          body: Buffer.concat(chunks),
          signal: AbortSignal.timeout(1000),
        });
        await forwarded.body?.cancel();
        response.writeHead(forwarded.status).end();
      },
      async ({ runtime: notifications, operator, authority, url }) => {
        const owned: Array<() => Promise<unknown>> = [];
        const errors: unknown[] = [];
        try {
          const postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
          owned.push(() => postgres.stop());
          const authorityPath = join(directory, 'authority.json');
          await writeFile(authorityPath, JSON.stringify(authorityFixture()), { mode: 0o600 });
          // Run the actual CLI in an isolated cwd so dotenv cannot load private checkout files.
          const recoverResult = async (id: string) => {
            const started = performance.now();
            const invocation = exec(
              process.execPath,
              [
                '--import',
                resolve('node_modules/tsx/dist/loader.mjs'),
                resolve('scripts/operator.ts'),
                'recover-result',
                '--authority-file',
                authorityPath,
                '--id',
                id,
              ],
              {
                cwd: directory,
                env: {
                  PATH: process.env.PATH,
                  HOME: process.env.HOME,
                  TMPDIR: process.env.TMPDIR,
                  DATABASE_URL: postgres.getConnectionUri(),
                },
                timeout: 10000,
              }
            );
            const { stdout } = await invocation;
            const outcome = z.object({ recovered: z.boolean() }).parse(JSON.parse(stdout));
            console.info('Receipt-based recover-result CLI completed and reaped', {
              pid: invocation.child.pid,
              exitCode: invocation.child.exitCode,
              durationMs: performance.now() - started,
              id,
              ...outcome,
            });
            return outcome;
          };
          const pool = new Pool({ connectionString: postgres.getConnectionUri() });
          owned.push(() => pool.end());
          await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
          await Effect.runPromise(
            activateLifecycle(postgres.getConnectionUri(), authority.identity)
          );
          const persistence = lifecyclePostgresLayer({
            databaseUrl: postgres.getConnectionUri(),
            revision: authority.identity,
            ...authority.delivery,
            leaseMs: 1000,
          });
          const capability = ManagedRuntime.make(
            lifecycleLayer({
              assetTypes: authority.assetTypes,
              revision: authority.identity,
              applications: authority.applications,
            }).pipe(Layer.provideMerge(persistence))
          );
          owned.push(() => capability.dispose());
          const lifecycle = await capability.runPromise(Lifecycle);
          const outbox = await capability.runPromise(ResultOutbox);
          const context = {
            occurrence: {
              source: 'https://example.test/application',
              id: 'original-command-event',
            },
            correlationId: 'opaque-workflow-reference',
          };
          const result = await capability.runPromise(
            lifecycle.command(
              'user',
              {
                operation: 'create',
                commandId: 'business-command-1',
                applicationReference: 'different-application-reference',
                assetType: 'picture',
                ownerSubject: 'owner-1',
              },
              context
            )
          );
          expect(result).toMatchObject({
            commandId: 'business-command-1',
            applicationReference: 'different-application-reference',
            outcome: 'created',
          });
          const manager = await operator.jetstreamManager();
          // Controlled stream routing rejection, not an unavailable broker: notices and operators stay live.
          await manager.streams.update('ASSET_RESULTS', {
            subjects: ['controlled.result-rejection'],
          });
          await notifications.runPromise(OperatorNotificationHealth);
          let holdAcknowledgements = true;
          let acknowledgements = 0;
          const claims: ResultPublication[] = [];
          const user = authority.applications.user;
          if (!user) throw new Error('Missing User authority fixture');
          function startDispatcher() {
            const runtime = ManagedRuntime.make(
              protectedCommandsLayer({
                url,
                applications: { user },
                credential: authority.broker.service,
                maxAckPending: authority.broker.maxAckPending,
                ...authority.delivery,
              }).pipe(
                Layer.provide(
                  Layer.merge(
                    Layer.succeed(Lifecycle, lifecycle),
                    Layer.succeed(ResultOutbox, {
                      ...outbox,
                      claim: (limit) =>
                        outbox
                          .claim(limit)
                          .pipe(
                            Effect.tap((publications) =>
                              Effect.sync(() => claims.push(...publications))
                            )
                          ),
                      alerted: (alert) =>
                        Effect.suspend(() => {
                          acknowledgements++;
                          return holdAcknowledgements
                            ? Effect.fail(
                                new LifecycleFailure({
                                  operation: 'controlled-local-alert-acknowledgement',
                                  cause: new Error(
                                    'Controlled failure after confirmed broker publication'
                                  ),
                                })
                              )
                            : outbox.alerted(alert);
                        }),
                    })
                  )
                )
              )
            );
            owned.push(() => runtime.dispose());
            return runtime;
          }
          let dispatcher = startDispatcher();
          await dispatcher.runPromise(ProtectedCommandHealth);
          const alerts = () => capability.runPromise(outbox.pendingAlerts(10));
          const receipts = async () => {
            const response = await fetch(`${receiver.url}/receipts`, {
              headers: {
                authorization: `Basic ${Buffer.from('operator:operator-inbox-token').toString('base64')}`,
              },
              signal: AbortSignal.timeout(1000),
            });
            expect(response.status).toBe(200);
            return z
              .array(
                z.object({
                  notice: z
                    .object({ id: z.string(), resultId: z.string().regex(/^[a-f0-9]{64}$/) })
                    .passthrough(),
                  receivedAt: z.string(),
                })
              )
              .parse(await response.json());
          };
          await expect
            .poll(async () => (await manager.streams.info('ASSET_QUARANTINE')).state.messages, {
              timeout: 5000,
            })
            .toBe(1);
          expect(httpFailures).toBe(3);
          const [first] = await alerts();
          if (!first) throw new Error('Missing first quarantine');
          expect(await alerts()).toEqual([first]);
          await expect.poll(() => acknowledgements, { timeout: 3000 }).toBeGreaterThan(1);
          expect((await manager.streams.info('ASSET_OPERATIONS')).state.messages).toBe(1);
          expect(await receipts()).toEqual([]);
          rejectHttp = false;
          await recoverQuarantine(operator, authority, 'user', 1);
          await expect.poll(receipts, { timeout: 3000 }).toEqual([
            expect.objectContaining({
              notice: expect.objectContaining({
                kind: 'result-quarantine',
                applicationId: 'user',
                context,
              }),
            }),
          ]);
          const deliveredReceipts = await receipts();
          await dispatcher.dispose();
          await receiver.stop();
          receiver = await startReceiver();
          expect(await alerts()).toEqual([first]);
          dispatcher = startDispatcher();
          await dispatcher.runPromise(ProtectedCommandHealth);
          const before = acknowledgements;
          await expect.poll(() => acknowledgements, { timeout: 3000 }).toBeGreaterThan(before);
          const persistedReceipts = await receipts();
          expect(persistedReceipts).toEqual(deliveredReceipts);
          const [firstReceipt] = persistedReceipts;
          if (!firstReceipt) throw new Error('Missing first authenticated persisted receipt');
          const visible = await fetch(`${receiver.url}/`, {
            headers: {
              authorization: `Basic ${Buffer.from('operator:operator-inbox-token').toString('base64')}`,
            },
            signal: AbortSignal.timeout(1000),
          });
          expect(visible.status).toBe(200);
          expect(await visible.text()).toContain(firstReceipt.notice.resultId);
          expect((await manager.streams.info('ASSET_OPERATIONS')).state.messages).toBe(2); // Original and explicit webhook recovery replay.
          holdAcknowledgements = false;
          await expect.poll(alerts, { timeout: 3000 }).toEqual([]);
          await dispatcher.dispose();
          expect(firstReceipt.notice.resultId).toBe(first.id);
          expect(firstReceipt.notice.id).not.toBe(firstReceipt.notice.resultId);
          expect(await recoverResult(firstReceipt.notice.id)).toEqual({ recovered: false });
          expect(await alerts()).toEqual([]);
          expect(await recoverResult(firstReceipt.notice.resultId)).toEqual({ recovered: true });
          expect(await recoverResult(firstReceipt.notice.resultId)).toEqual({ recovered: false });
          holdAcknowledgements = true;
          dispatcher = startDispatcher();
          await dispatcher.runPromise(ProtectedCommandHealth);
          await expect.poll(receipts, { timeout: 5000 }).toHaveLength(2);
          const [second] = await alerts();
          if (!second) throw new Error('Missing renewed quarantine');
          expect(second.id).toBe(first.id);
          expect(second.notificationOccurrence).not.toBe(first.notificationOccurrence);
          const beforeReceiverRestart = await receipts();
          await receiver.stop();
          receiver = await startReceiver();
          const secondReceipts = await receipts();
          expect(secondReceipts).toEqual(beforeReceiverRestart);
          const secondReceipt = secondReceipts[1];
          if (!secondReceipt) throw new Error('Missing renewed authenticated receipt');
          expect(secondReceipts[0]).toEqual(firstReceipt);
          expect(secondReceipt.notice.id).not.toBe(firstReceipt.notice.id);
          expect(secondReceipt.notice.resultId).toBe(firstReceipt.notice.resultId);
          expect(secondReceipt.notice.resultId).toBe(first.id);
          const renewedVisible = await fetch(`${receiver.url}/`, {
            headers: {
              authorization: `Basic ${Buffer.from('operator:operator-inbox-token').toString('base64')}`,
            },
            signal: AbortSignal.timeout(1000),
          });
          expect(renewedVisible.status).toBe(200);
          const rendered = await renewedVisible.text();
          for (const receipt of secondReceipts) {
            expect(rendered).toContain(receipt.notice.id);
            expect(rendered).toContain(receipt.notice.resultId);
          }
          expect(secondReceipt.notice).toMatchObject({
            applicationId: 'user',
            kind: 'result-quarantine',
            subject: 'asset.results.user',
            reason: 'exhausted',
            context,
          });
          await capability.runPromise(outbox.alerted(first));
          const oldClaim = claims[0];
          if (!oldClaim) throw new Error('Missing original claimed result');
          await capability.runPromise(outbox.published(oldClaim));
          await capability.runPromise(outbox.failed(oldClaim));
          expect(await alerts()).toEqual([second]);
          await dispatcher.dispose();
          await manager.streams.update('ASSET_RESULTS', { subjects: ['asset.results.user'] });
          expect(await recoverResult(secondReceipt.notice.resultId)).toEqual({ recovered: true });
          expect(await recoverResult(secondReceipt.notice.resultId)).toEqual({ recovered: false });
          holdAcknowledgements = false;
          dispatcher = startDispatcher();
          await dispatcher.runPromise(ProtectedCommandHealth);
          const application = await connect({
            servers: url,
            user: 'user-1',
            pass: 'user-secret',
            inboxPrefix: '_ASSET_INBOX.user',
          });
          owned.push(() => application.close());
          const consumer = await application
            .jetstream()
            .consumers.get('ASSET_RESULTS', 'results_user');
          const message = await consumer.next({ expires: 3000 });
          expect(message?.json()).toMatchObject({
            id: first.id,
            data: result,
            causationid: context.occurrence.id,
          });
          message?.ack();
          await application.flush();
          // Await the CLI's existing process deadline before tearing down its database.
          expect(await recoverResult(secondReceipt.notice.resultId)).toEqual({ recovered: false });
          expect(await capability.runPromise(outbox.claim(1))).toEqual([]);
          expect(await receipts()).toHaveLength(2);
          expect(claims).toHaveLength(7);
          console.info('Two result quarantine cycles retained distinct receipts', {
            originalResultId: first.id,
            firstOccurrence: first.notificationOccurrence,
            secondOccurrence: second.notificationOccurrence,
            firstReceiptId: firstReceipt.notice.id,
            secondReceiptId: secondReceipt.notice.id,
            receiptRecoveryId: secondReceipt.notice.resultId,
            retainedReceipts: (await receipts()).length,
            controlledHttpRejections: httpFailures,
            originalResultClaims: claims.length,
          });
          for (const claim of claims) {
            expect(claim.id).toBe(first.id);
            expect(claim.result).toEqual(result);
            expect(claim.context).toEqual(context);
          }
        } catch (error) {
          errors.push(error);
        } finally {
          for (const release of owned.reverse()) {
            try {
              await release();
            } catch (error) {
              errors.push(error);
            }
          }
        }
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1)
          throw new AggregateError(errors, 'Result notification contract failed');
      }
    );
  } catch (error) {
    failures.push(error);
  } finally {
    for (const release of releases.reverse()) {
      try {
        await release();
      } catch (error) {
        failures.push(error);
      }
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'Result notification fixture failed');
});

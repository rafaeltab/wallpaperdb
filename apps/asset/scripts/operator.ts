import { assetBrokerTransport } from '../src/adapters/nats.js';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { config as loadEnv } from 'dotenv';
import { Effect, ManagedRuntime } from 'effect';
import { connect, type NatsConnection } from 'nats';
import { AssetCommandResultSchema, CreateAssetSchema } from '@wallpaperdb/events/schemas';
import { readAuthority } from '../src/authority.js';
import {
  activateLifecycle,
  initializeLifecycle,
  lifecyclePostgresLayer,
} from '../src/adapters/lifecycle/index.js';
import { provisionAssetBroker, recoverQuarantine } from '../src/adapters/commands/index.js';
import { ResultOutbox } from '../src/capabilities/lifecycle/index.js';

async function usingConnection<A>(
  url: string,
  user: string,
  pass: string,
  inboxPrefix: string,
  run: (connection: NatsConnection) => Promise<A>
) {
  const connection = await connect({
    ...assetBrokerTransport(url),
    user,
    pass,
    inboxPrefix,
    timeout: 5000,
  });
  try {
    return await run(connection);
  } finally {
    await connection.close();
  }
}
export async function runOperator(args: readonly string[]) {
  loadEnv();
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      url: { type: 'string' },
      application: { type: 'string' },
      sequence: { type: 'string' },
      id: { type: 'string' },
      'command-id': { type: 'string' },
      'owner-subject': { type: 'string' },
      reference: { type: 'string' },
      'asset-type': { type: 'string' },
      'authority-file': { type: 'string' },
    },
  });
  const mode = positionals[0];
  if (
    positionals.length !== 1 ||
    ![
      'bootstrap',
      'provision',
      'activate',
      'create',
      'quarantine',
      'recover',
      'recover-result',
    ].includes(mode ?? '')
  )
    throw new Error(
      'Select bootstrap, provision, activate, create, quarantine, recover or recover-result'
    );
  const authority = readAuthority(
    values['authority-file'] ?? process.env.ASSET_AUTHORITY_FILE ?? './.authority.json'
  );
  const url = values.url ?? process.env.NATS_URL;
  const databaseUrl = process.env.DATABASE_URL;
  if (mode === 'bootstrap' || mode === 'provision') {
    if (!url) throw new Error('NATS_URL required');
    for (const application of Object.values(authority.applications))
      await usingConnection(
        url,
        application.operatorUser,
        authority.broker.operator.password,
        '_ASSET_INBOX.operator',
        (connection) => provisionAssetBroker(connection, authority, application.id)
      );
    if (mode === 'bootstrap') {
      if (!databaseUrl) throw new Error('DATABASE_URL required');
      await Effect.runPromise(initializeLifecycle(databaseUrl, authority.identity));
    }
    return {
      outcome: mode === 'bootstrap' ? 'initialized' : 'provisioned',
      configuration: authority.identity,
    };
  }
  if (mode === 'activate') {
    if (!databaseUrl) throw new Error('DATABASE_URL required');
    await Effect.runPromise(activateLifecycle(databaseUrl, authority.identity));
    return { outcome: 'activated', configuration: authority.identity };
  }
  if (mode === 'recover-result') {
    if (!databaseUrl || !values.id || !/^[a-f0-9]{64}$/.test(values.id))
      throw new Error('DATABASE_URL and result occurrence ID required');
    const id = values.id;
    const runtime = ManagedRuntime.make(
      lifecyclePostgresLayer({
        databaseUrl,
        revision: authority.identity,
        ...authority.delivery,
        leaseMs: 30000,
      })
    );
    try {
      return {
        recovered: await runtime.runPromise(ResultOutbox.use((outbox) => outbox.recover(id))),
      };
    } finally {
      await runtime.dispose();
    }
  }
  const application =
    values.application && Object.hasOwn(authority.applications, values.application)
      ? authority.applications[values.application]
      : undefined;
  if (!application || !url) throw new Error('A configured application and NATS_URL required');
  if (mode === 'create') {
    const credential = application.credentials[0];
    if (!credential) throw new Error('Application credential required');
    const data = CreateAssetSchema.parse({
      commandId: values['command-id'],
      applicationReference: values.reference ?? '',
      ownerSubject: values['owner-subject'],
      assetType: values['asset-type'],
    });
    return usingConnection(
      url,
      credential.user,
      credential.password,
      application.inboxPrefix,
      async (connection) => {
        const results = await connection
          .jetstream()
          .consumers.get('ASSET_RESULTS', application.resultConsumer);
        await connection.jetstream().publish(
          application.createSubject,
          JSON.stringify({
            specversion: '1.0',
            id: randomUUID(),
            source: `https://wallpaperdb/applications/${application.id}`,
            type: 'asset.command.create',
            time: new Date().toISOString(),
            datacontenttype: 'application/json',
            data,
          }),
          { timeout: 5000 }
        );
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
          const message = await results.next({ expires: 5000 });
          if (!message) continue;
          const result = AssetCommandResultSchema.parse(message.json<{ data: unknown }>().data);
          if (result.commandId === data.commandId) {
            message.ack();
            await connection.flush();
            return result;
          }
          message.nak(1000);
        }
        throw new Error('Creation remains durable; result not observed within the CLI deadline');
      }
    );
  }
  return usingConnection(
    url,
    application.operatorUser,
    authority.broker.operator.password,
    '_ASSET_INBOX.operator',
    async (connection) => {
      if (mode === 'recover') {
        const result = await recoverQuarantine(
          connection,
          authority,
          application.id,
          Number(values.sequence)
        );
        return { recovered: true, sequence: result.seq };
      }
      const manager = await connection.jetstreamManager();
      const info = await manager.streams.info('ASSET_QUARANTINE');
      const records: unknown[] = [];
      for (
        let sequence = Math.max(info.state.first_seq, info.state.last_seq - 19);
        sequence <= info.state.last_seq && info.state.messages;
        sequence++
      ) {
        const record = await manager.streams.getMessage('ASSET_QUARANTINE', { seq: sequence });
        const event = record.json<{
          id: string;
          type: string;
          time: string;
          data: { subject: string; reason: string };
        }>();
        records.push({
          sequence,
          id: event.id,
          type: event.type,
          time: event.time,
          subject: event.data.subject,
          reason: event.data.reason,
        });
      }
      return { records };
    }
  );
}
if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  runOperator(process.argv.slice(2)).then(
    (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
    () => {
      process.stderr.write(
        'Asset operator action failed. Check configuration and service diagnostics.\n'
      );
      process.exitCode = 1;
    }
  );
}

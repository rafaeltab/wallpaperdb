import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Layer, ManagedRuntime } from 'effect';
import { databaseLayer } from '../src/adapters/database/index.js';
import {
  attachmentPostgresLayer,
  recoverConfirmation,
} from '../src/adapters/picture-attachments/index.js';
import {
  AttachmentDelivery,
  pictureAttachmentsLayer,
} from '../src/capabilities/picture-attachments/index.js';
import { loadConfig } from '../src/config.js';
/** Trusted local operator entry point. No author HTTP route exposes recovery. */
export async function runAttachmentOperator(
  args: readonly string[],
  options: {
    readonly databaseUrl: string;
    readonly maxAttempts: number;
    readonly retryDelayMs: number;
  }
) {
  const [command, id, ...extra] = args;
  if (
    !['recover-outbox', 'recover-confirmation'].includes(command ?? '') ||
    !id ||
    id.length > 256 ||
    extra.length
  )
    throw new Error('Expected recover-outbox|recover-confirmation and one retained identity');
  const store = attachmentPostgresLayer({ ...options, leaseMs: 30000 }).pipe(
    Layer.provide(databaseLayer(options))
  );
  const runtime = ManagedRuntime.make(pictureAttachmentsLayer.pipe(Layer.provideMerge(store)));
  try {
    return {
      recovered: await runtime.runPromise(
        command === 'recover-outbox'
          ? AttachmentDelivery.use((d) => d.recover(id))
          : recoverConfirmation(id)
      ),
    };
  } finally {
    await runtime.dispose();
  }
}
if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  if (!config.attachmentWorkflow) throw new Error('User Asset workflow configuration is required');
  process.stdout.write(
    JSON.stringify(
      await runAttachmentOperator(process.argv.slice(2), {
        databaseUrl: config.databaseUrl,
        ...config.attachmentWorkflow,
      })
    ) + '\n'
  );
}

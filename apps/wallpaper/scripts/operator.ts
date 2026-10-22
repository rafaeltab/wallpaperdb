import 'dotenv/config';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { loadConfig } from '../src/config.js';
import { WorkflowDelivery, creationLayer } from '../src/capabilities/creation/index.js';
import { workflowPostgresLayer } from '../src/adapters/workflow/index.js';
import { recoverConfirmation } from '../src/adapters/asset-workflow/index.js';
export async function runOperator(args: readonly string[]) {
  const { positionals, values } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: { id: { type: 'string' } },
  });
  const mode = positionals[0];
  const id = values.id;
  if (
    positionals.length !== 1 ||
    (mode !== 'recover-outbox' && mode !== 'recover-confirmation') ||
    !id ||
    id.length > 256
  )
    throw new Error('Select recover-outbox or recover-confirmation with --id');
  const config = loadConfig();
  if (!config.workflow) throw new Error('Wallpaper workflow configuration required');
  const persistence = workflowPostgresLayer({
    ...config.workflow,
    databaseUrl: config.databaseUrl,
    leaseMs: 30000,
  });
  const runtime = ManagedRuntime.make(
    creationLayer(config.workflow.ownerNamespace).pipe(Layer.provideMerge(persistence))
  );
  try {
    return await runtime.runPromise(
      Effect.gen(function* () {
        const delivery = yield* WorkflowDelivery;
        if (mode === 'recover-outbox') return yield* delivery.recover(id);
        return yield* recoverConfirmation(id);
      })
    );
  } finally {
    await runtime.dispose();
  }
}
if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url))
  runOperator(process.argv.slice(2))
    .then((recovered) => {
      process.stdout.write(
        recovered ? 'Recovery responsibility accepted\n' : 'No recoverable record found\n'
      );
      process.exitCode = recovered ? 0 : 1;
    })
    .catch(() => {
      process.stderr.write('Wallpaper recovery failed; inspect trusted service diagnostics\n');
      process.exitCode = 1;
    });

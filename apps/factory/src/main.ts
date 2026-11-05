import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { z } from 'zod';
import { reconcileRejectedPlanner } from './adapters/t3/index.js';
import { startFactory } from './composition/index.js';
import { initializeState, stateDirectory } from './platform/index.js';

const mode = process.argv[2];
if (mode === '--migrate-only') {
  const selected = process.argv[3];
  if (!selected?.startsWith('/'))
    throw new Error('Migration requires an explicit absolute state directory');
  const directory = stateDirectory(selected);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  execFileSync(
    '/usr/bin/flock',
    [
      '--nonblock',
      join(directory, 'service.lock'),
      process.execPath,
      ...process.execArgv,
      resolve(process.argv[1]),
      '--migrate-locked',
      directory,
    ],
    { stdio: 'inherit' }
  );
} else if (mode === '--migrate-locked') {
  console.log(JSON.stringify(initializeState(process.argv[3], true)));
} else if (mode === '--reconcile-planner-rejection') {
  const [selected, requestId, revision, operator, evidence] = process.argv.slice(3);
  const attestation = z
    .object({
      requestId: z.string().uuid(),
      revision: z.coerce.number().int().nonnegative(),
      operator: z.string().min(1).max(200),
      evidence: z.string().min(1).max(1000),
      code: z.literal(-32602),
    })
    .parse({ requestId, revision, operator, evidence, code: -32602 });
  if (!selected?.startsWith('/')) throw new Error('Explicit absolute state root required');
  const directory = stateDirectory(selected);
  // The public command holds the same service lock used for migration and activation.
  execFileSync(
    '/usr/bin/flock',
    [
      '--nonblock',
      join(directory, 'service.lock'),
      process.execPath,
      ...process.execArgv,
      resolve(process.argv[1]),
      '--reconcile-planner-locked',
      directory,
      JSON.stringify(attestation),
    ],
    { stdio: 'inherit' }
  );
} else if (mode === '--reconcile-planner-locked') {
  const attestation = z
    .object({
      requestId: z.string().uuid(),
      revision: z.number().int().nonnegative(),
      operator: z.string().min(1).max(200),
      evidence: z.string().min(1).max(1000),
      code: z.literal(-32602),
    })
    .strict()
    .parse(JSON.parse(process.argv[4]));
  const state = await reconcileRejectedPlanner(
    join(stateDirectory(process.argv[3]), 'planner'),
    attestation
  );
  console.log(
    JSON.stringify({
      requestId: state.requestId,
      revision: state.revision,
      phase: state.phase,
      retired: state.retired,
      reconciliation: state.reconciliation,
    })
  );
} else {
  const running = await startFactory(process.env);
  process.once('SIGTERM', () => {
    void running.close();
  });
  process.once('SIGINT', () => {
    void running.close();
  });
}

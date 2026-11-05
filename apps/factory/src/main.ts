import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { startFactory } from './composition/index.js';
import { initializeState } from './platform/index.js';

const mode = process.argv[2];
if (mode === '--migrate-only') {
  const directory = process.argv[3];
  if (!directory?.startsWith('/'))
    throw new Error('Migration requires an explicit absolute state directory');
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
} else {
  const running = await startFactory(process.env);
  process.once('SIGTERM', () => {
    void running.close();
  });
  process.once('SIGINT', () => {
    void running.close();
  });
}

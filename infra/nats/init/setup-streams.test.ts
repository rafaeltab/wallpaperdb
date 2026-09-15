import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function setupStreams(existingStreams = '') {
  const directory = mkdtempSync(join(tmpdir(), 'profile-stream-setup-'));
  temporaryDirectories.push(directory);
  const callsFile = join(directory, 'calls.jsonl');
  writeFileSync(join(directory, 'nats'), `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(process.env.STREAM_SETUP_CALLS, JSON.stringify(args) + '\\n');
if (args[0] === 'stream' && args[1] === 'info') {
  process.exit(process.env.EXISTING_STREAMS.split(',').includes(args[2]) ? 0 : 1);
}
`, { mode: 0o755 });
  execFileSync('sh', [fileURLToPath(new URL('./setup-streams.sh', import.meta.url))], {
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      NATS_SERVER: 'nats://test-streams:4222',
      STREAM_SETUP_CALLS: callsFile,
      EXISTING_STREAMS: existingStreams,
    },
    stdio: 'pipe',
  });
  return readFileSync(callsFile, 'utf8').trim().split('\n').map((line): string[] => JSON.parse(line));
}

describe('Profile projection stream setup', () => {
  it('updates existing streams in place without deleting or recreating retained events', () => {
    const calls = setupStreams('WALLPAPER,PROFILE');
    for (const name of ['WALLPAPER', 'PROFILE']) {
      const edit = calls.find((args) => args[1] === 'edit' && args[2] === name);
      expect(edit).toContain('--max-age=0');
      expect(edit).toContain('--force');
    }
    expect(calls.every((args) => ['info', 'edit'].includes(args[1]))).toBe(true);
  });

  it('creates Wallpaper and Profile streams without age-based event expiry', () => {
    const calls = setupStreams();
    for (const name of ['WALLPAPER', 'PROFILE']) {
      const creation = calls.find((args) => args[1] === 'add' && args[2] === name);
      expect(creation).toContain('--max-age=0');
      expect(creation).toContain('--max-msgs=-1');
      expect(creation).toContain('--max-bytes=-1');
    }
  });
});

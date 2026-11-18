import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { t3ObserverCredential } from '../src/adapters/t3/index.js';

it('provisions one private read-only credential, reuses it after restart and replaces it before expiry or after rejection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'factory-observer-credential-'));
  const binary = join(directory, 't3');
  const log = join(directory, 'calls');
  const counter = join(directory, 'counter');
  let now = Date.now();
  await writeFile(
    binary,
    `#!/usr/bin/env node
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
const args=process.argv.slice(2); appendFileSync(${JSON.stringify(log)},JSON.stringify(args)+'\\n');
if(args.slice(0,3).join(' ')==='auth session issue') {
let count=0;try{count=Number(readFileSync(${JSON.stringify(counter)},'utf8'));}catch{}
writeFileSync(${JSON.stringify(counter)},String(++count));
console.log(JSON.stringify({sessionId:'session-'+count,token:'controlled-token-'+count,scopes:['orchestration:read'],method:'bearer-access-token',expiresAt:new Date(Date.now()+30*86400000).toISOString()}));
} else if(args.slice(0,3).join(' ')==='auth session revoke') console.log('Revoked'); else process.exit(1);
`,
    { mode: 0o700 }
  );
  const configuration = {
    binary,
    project: directory,
    directory: join(directory, 'private'),
    origin: 'http://127.0.0.1:3773',
    now: () => now,
    report: () => undefined,
  };
  try {
    const credential = t3ObserverCredential(configuration);
    const first = await Promise.all([credential(), credential()]);
    expect(first[0]).toEqual(first[1]);
    expect(first[0].token).toBe('controlled-token-1');
    expect((await stat(join(configuration.directory, 'session'))).mode & 0o777).toBe(0o600);
    const reopened = t3ObserverCredential(configuration);
    const reused = await reopened();
    expect(reused.token).toBe(first[0].token);
    expect(reused.replaced.aborted).toBe(false);
    now += 29.5 * 86400000;
    expect((await reopened()).token).toBe('controlled-token-2');
    expect(reused.replaced.aborted).toBe(true);
    now = Date.now();
    expect((await reopened(true)).token).toBe('controlled-token-3');
    const calls: string[][] = (await readFile(log, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(calls.filter((args) => args[2] === 'issue')).toHaveLength(3);
    expect(
      calls
        .filter((args) => args[2] === 'issue')
        .every(
          (args) => args.includes('orchestration:read') && !args.includes('orchestration:operate')
        )
    ).toBe(true);
    expect(calls.filter((args) => args[2] === 'revoke').map((args) => args[3])).toEqual([
      'session-1',
      'session-2',
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

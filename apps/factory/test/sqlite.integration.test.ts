import Database from 'better-sqlite3';
import { startFactory } from '../src/composition/index.js';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  readlink,
  rm,
  writeFile,
  cp,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  publisher,
  readRecord,
  recordNames,
  initializeState,
  durabilitySettings,
} from '../src/platform/index.js';

it('imports all legacy namespaces atomically, retains originals and reopens claims', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factory-sqlite-'));
  try {
    await mkdir(join(root, 'joins', 'a'.repeat(64)), { recursive: true });
    await writeFile(join(root, 'launch-claimed.json'), '{"version":1}');
    await writeFile(join(root, 'joins', 'a'.repeat(64), 'launch.json'), '{"threadId":"retained"}');
    expect(await publisher(root)('launch-claimed.json', { version: 1 })).toBe(false);
    expect(await readRecord(join(root, 'joins', 'a'.repeat(64)), 'launch.json')).toEqual({
      threadId: 'retained',
    });
    expect(await recordNames(join(root, 'joins'))).toEqual(['a'.repeat(64)]);
    expect(await readFile(join(root, 'launch-claimed.json'), 'utf8')).toBe('{"version":1}');
    expect(await publisher(root)('new-claim.json', { version: 1 })).toBe(true);
    expect(await publisher(root)('new-claim.json', { version: 2 })).toBe(false);
    expect(await readdir(root)).not.toContain('new-claim.json');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('fails invalid and gapped imports without committing partial claims and can retry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factory-sqlite-'));
  try {
    await writeFile(join(root, 'launch-claimed.json'), '{"version":1}');
    await writeFile(join(root, 'control-1.json'), '{"revision":1,"cancelled":false,"claimed":[]}');
    await expect(readRecord(root, 'launch-claimed.json')).rejects.toThrow();
    await writeFile(join(root, 'control-0.json'), '{"revision":0,"cancelled":false,"claimed":[]}');
    expect(await publisher(root)('launch-claimed.json', { version: 1 })).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('serializes independent processes and rolls back an interrupted transaction', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factory-sqlite-'));
  try {
    initializeState(root);
    const run = promisify(execFile);
    const child = (mode: string) =>
      run(process.execPath, ['--import', 'tsx', 'test/fixtures/sqlite-process.ts', root, mode]);
    const results = await Promise.all([child('claim'), child('claim')]);
    expect(results.map((result) => result.stdout.trim()).sort()).toEqual(['false', 'true']);
    await expect(child('interrupt')).rejects.toMatchObject({ code: 7 });
    expect(await readRecord(root, 'interrupted.json')).toBeNull();
    expect(await publisher(root)('launch-claimed.json', { version: 1 })).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('maps job, scheduler, planner and join namespaces to one database', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factory-sqlite-'));
  try {
    initializeState(root);
    for (const namespace of [
      '',
      'issue-42',
      'planner',
      'joins/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/recovery/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    ]) {
      await publisher(join(root, namespace))('claim.json', { namespace });
      expect(await readRecord(join(root, namespace), 'claim.json')).toEqual({ namespace });
      if (namespace)
        await expect(readFile(join(root, namespace, 'factory.sqlite'))).rejects.toMatchObject({
          code: 'ENOENT',
        });
    }
    expect(initializeState(root)).toEqual({ format: 2, records: 4 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('runs migration-only with no external configuration and refuses an active service lock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factory-sqlite-'));
  try {
    const run = promisify(execFile);
    const args = ['--import', 'tsx', 'src/main.ts', '--migrate-only', root];
    expect(JSON.parse((await run(process.execPath, args)).stdout)).toEqual({
      format: 2,
      records: 0,
    });
    const lock = spawn(
      '/usr/bin/flock',
      [
        '--nonblock',
        join(root, 'service.lock'),
        process.execPath,
        '-e',
        "console.log('locked');process.stdin.resume()",
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
    try {
      await once(lock.stdout, 'data');
      await expect(run(process.execPath, args)).rejects.toMatchObject({ code: 1 });
    } finally {
      lock.stdin.end();
      await once(lock, 'exit');
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('performs initialized reads without write locks and closes repeated operation connections', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factory-sqlite-'));
  try {
    initializeState(root);
    const writer = new Database(join(root, 'factory.sqlite'));
    try {
      writer.exec('BEGIN IMMEDIATE');
      const result = await promisify(execFile)(
        process.execPath,
        ['--import', 'tsx', 'test/fixtures/sqlite-process.ts', root, 'read'],
        { timeout: 3000 }
      );
      expect(result.stdout.trim()).toBe('read complete');
      writer.exec('ROLLBACK');
    } finally {
      writer.close();
    }
    for (let index = 0; index < 50; index++) {
      expect(await publisher(root)(`claim-${index}.json`, { index })).toBe(true);
      expect(await readRecord(root, `claim-${index}.json`)).toEqual({ index });
    }
    const descriptors = await readdir('/proc/self/fd');
    const links = await Promise.all(
      descriptors.map((fd) => readlink(`/proc/self/fd/${fd}`).catch(() => ''))
    );
    expect(links.filter((path) => path.startsWith(root))).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.each(['{broken', '{"revision":0}', '{"revision":9,"cancelled":false,"claimed":[]}'])(
  'rejects malformed legacy controls atomically: %s',
  async (text) => {
    const root = await mkdtemp(join(tmpdir(), 'factory-sqlite-'));
    try {
      await writeFile(join(root, 'launch-claimed.json'), '{"version":1}');
      await writeFile(join(root, 'control-0.json'), text);
      expect(() => initializeState(root)).toThrow();
      const client = new Database(join(root, 'factory.sqlite'));
      try {
        expect(client.prepare('SELECT count(*) AS count FROM records').get()).toEqual({ count: 0 });
        expect(client.prepare('SELECT count(*) AS count FROM metadata').get()).toEqual({
          count: 0,
        });
      } finally {
        client.close();
      }
      expect(await readFile(join(root, 'control-0.json'), 'utf8')).toBe(text);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);

it('imports a copied legacy snapshot without traversing scratch worktrees or unrelated configuration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factory-sqlite-'));
  const source = join(root, 'original');
  const copy = join(root, 'copy');
  try {
    await mkdir(join(source, 'repo'), { recursive: true });
    await mkdir(join(source, 'joins', 'a'.repeat(64), 'replay-scratch'), { recursive: true });
    await writeFile(join(source, 'launch-claimed.json'), '{"version":1}');
    await writeFile(join(source, 'config.json'), '{not workflow state');
    await writeFile(join(source, 'repo', 'intent.json'), '{not workflow state');
    await writeFile(
      join(source, 'joins', 'a'.repeat(64), 'replay-scratch', 'intent.json'),
      '{not workflow state'
    );
    await cp(source, copy, { recursive: true });
    expect(initializeState(copy)).toEqual({ format: 2, records: 1 });
    expect(initializeState(copy)).toEqual({ format: 2, records: 1 });
    expect(await readFile(join(source, 'launch-claimed.json'), 'utf8')).toBe('{"version":1}');
    await expect(readFile(join(source, 'factory.sqlite'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.each(['issue-42', 'planner', 'joins'])(
  'refuses parent import over an existing %s database without losing child authority',
  async (namespace) => {
    const root = await mkdtemp(join(tmpdir(), 'factory-sqlite-'));
    const child = join(root, namespace);
    try {
      initializeState(child);
      await publisher(child)('launch-claimed.json', { version: 1 });
      expect(() => initializeState(root)).toThrow('Nested SQLite database');
      expect(await publisher(child)('launch-claimed.json', { version: 1 })).toBe(false);
      await expect(readFile(join(root, 'factory.sqlite'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);

it('rejects an explicit state root nested beneath existing SQLite authority', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factory-sqlite-'));
  const child = join(root, 'issue-42');
  try {
    initializeState(root);
    await mkdir(child);
    await writeFile(join(child, 'launch-claimed.json'), '{"version":1}');
    expect(() => initializeState(child, true)).toThrow();
    await expect(
      startFactory({
        FACTORY_PROJECT: root,
        FACTORY_T3_PROJECT_ID: 'controlled',
        FACTORY_BASE: 'a'.repeat(40),
        FACTORY_T3_BINARY: '/missing/t3',
        FACTORY_STATE: child,
        FACTORY_PORT: '0',
      })
    ).rejects.toThrow(/state format/);
    await expect(
      promisify(execFile)(process.execPath, [
        '--import',
        'tsx',
        'src/main.ts',
        '--migrate-only',
        child,
      ])
    ).rejects.toMatchObject({ code: 1 });
    expect(await readFile(join(child, 'launch-claimed.json'), 'utf8')).toBe('{"version":1}');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('rejects a nested database introduced after parent initialization', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factory-sqlite-'));
  const source = await mkdtemp(join(tmpdir(), 'factory-sqlite-child-'));
  try {
    initializeState(root);
    initializeState(source);
    await publisher(source)('launch-claimed.json', { version: 1 });
    await mkdir(join(root, 'issue-42'));
    await cp(join(source, 'factory.sqlite'), join(root, 'issue-42', 'factory.sqlite'));
    expect(() => initializeState(root, true)).toThrow('Nested SQLite database');
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(source, { recursive: true, force: true });
  }
});

it('imports legacy competing-writer ownership under the shared joins namespace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factory-sqlite-'));
  const writers = join(root, 'joins', 'writers', 'a'.repeat(64));
  try {
    await mkdir(writers, { recursive: true });
    await writeFile(join(writers, 'writer-0.json'), '{"key":"retained-owner"}');
    expect(initializeState(root)).toEqual({ format: 2, records: 1 });
    expect(await readRecord(writers, 'writer-0.json')).toEqual({ key: 'retained-owner' });
    expect(await publisher(writers)('writer-0.json', { key: 'competing-owner' })).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('uses EXTRA synchronization with DELETE journaling on production connections', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factory-sqlite-'));
  try {
    expect(durabilitySettings(root)).toEqual({ journalMode: 'delete', synchronous: 3 });
    await publisher(root)('launch-claimed.json', { version: 1 });
    expect(durabilitySettings(root)).toEqual({ journalMode: 'delete', synchronous: 3 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('rejects explicit migration of an existing child database beneath another authority', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factory-sqlite-'));
  const source = await mkdtemp(join(tmpdir(), 'factory-sqlite-child-'));
  const child = join(root, 'issue-42');
  try {
    initializeState(root);
    initializeState(source);
    await publisher(source)('launch-claimed.json', { version: 1 });
    await mkdir(child);
    await cp(join(source, 'factory.sqlite'), join(child, 'factory.sqlite'));
    expect(() => initializeState(child)).toThrow(/ancestor/);
    await expect(
      promisify(execFile)(process.execPath, [
        '--import',
        'tsx',
        'src/main.ts',
        '--migrate-only',
        child,
      ])
    ).rejects.toMatchObject({ code: 1 });
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(source, { recursive: true, force: true });
  }
});

it('rejects a symlink alias hiding ancestor authority and allows a standalone alias', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factory-sqlite-'));
  try {
    const parent = join(root, 'parent');
    initializeState(parent);
    const child = join(parent, 'issue-42');
    await mkdir(child);
    const alias = join(root, 'alias');
    await symlink(child, alias);
    expect(() => initializeState(alias)).toThrow(/ancestor/);
    await expect(
      promisify(execFile)(process.execPath, [
        '--import',
        'tsx',
        'src/main.ts',
        '--migrate-only',
        alias,
      ])
    ).rejects.toMatchObject({ code: 1 });
    const standalone = join(root, 'standalone');
    await mkdir(standalone);
    const validAlias = join(root, 'valid-alias');
    await symlink(standalone, validAlias);
    expect(initializeState(validAlias)).toEqual({ format: 2, records: 0 });
    await publisher(join(validAlias, 'issue-42'))('launch-claimed.json', { version: 1 });
    expect(await readRecord(join(standalone, 'issue-42'), 'launch-claimed.json')).toEqual({
      version: 1,
    });
    expect(initializeState(standalone)).toEqual({ format: 2, records: 1 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('rejects declared namespace symlinks after parent initialization', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factory-sqlite-'));
  const source = await mkdtemp(join(tmpdir(), 'factory-sqlite-child-'));
  try {
    initializeState(root);
    initializeState(source);
    await symlink(source, join(root, 'issue-42'));
    expect(() => initializeState(root)).toThrow(/symlink/i);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(source, { recursive: true, force: true });
  }
});

it.each(['existing', 'dangling'])(
  'rejects a %s database-file symlink before adopting another states authority',
  async (mode) => {
    const root = await mkdtemp(join(tmpdir(), 'factory-sqlite-'));
    const source = await mkdtemp(join(tmpdir(), 'factory-sqlite-child-'));
    try {
      initializeState(source);
      await publisher(source)('launch-claimed.json', { version: 1 });
      await symlink(
        join(source, mode === 'existing' ? 'factory.sqlite' : 'missing.sqlite'),
        join(root, 'factory.sqlite')
      );
      expect(() => initializeState(root)).toThrow(/symlink/i);
      await expect(publisher(root)('launch-claimed.json', { version: 1 })).rejects.toThrow(
        /symlink/i
      );
      expect(await publisher(source)('launch-claimed.json', { version: 1 })).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(source, { recursive: true, force: true });
    }
  }
);

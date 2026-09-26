import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { expect, it } from 'vitest';

async function exportFromChild(mode: 'source' | 'database', databaseUrl?: string) {
  const exported: string[] = [];
  const collector = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      exported.push(Buffer.concat(chunks).toString());
      response.writeHead(200);
      response.end();
    });
  });
  await new Promise<void>((resolve) => collector.listen(0, '127.0.0.1', resolve));
  try {
    const address = collector.address();
    if (!address || typeof address === 'string') throw new Error('Missing collector address');
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          '--import',
          'tsx',
          'test/fixtures/telemetry-privacy.ts',
          mode,
          `http://127.0.0.1:${address.port}`,
        ],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 20_000,
          env: { ...process.env, TEST_DATABASE_URL: databaseUrl },
        }
      );
      const diagnostics: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => diagnostics.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => diagnostics.push(chunk));
      child.once('error', reject);
      child.once('close', (code) =>
        code === 0 ? resolve() : reject(new Error(Buffer.concat(diagnostics).toString()))
      );
    });
    const telemetry = exported.join('\n');
    expect(telemetry).toContain('privacy.export.control');
    return telemetry;
  } finally {
    collector.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      collector.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

it('keeps private native-fetch source paths and query strings out of production telemetry', async () => {
  const exported = await exportFromChild('source');
  expect(exported).not.toContain('private-source-path-marker');
  expect(exported).not.toContain('private-source-query-marker');
});

it('keeps PostgreSQL trigger diagnostics containing private import URLs out of production telemetry', async () => {
  const database = await new PostgreSqlContainer('postgres:16-alpine').start();
  const sql = postgres(database.getConnectionUri());
  try {
    const directory = new URL('../drizzle/', import.meta.url);
    for (const name of readdirSync(directory)
      .filter((name) => name.endsWith('.sql'))
      .sort())
      await sql.unsafe(readFileSync(new URL(name, directory), 'utf8'));
    await sql.unsafe(
      `create function reject_private_import() returns trigger language plpgsql as $$ begin raise exception 'provider insert rejected for %', NEW.source_url; end $$`
    );
    await sql.unsafe(
      `create trigger reject_private_import before insert on profile_picture_imports for each row execute function reject_private_import()`
    );
    const exported = await exportFromChild('database', database.getConnectionUri());
    expect(exported).not.toContain('private-database-source-marker');
    expect(await sql`select * from profiles`).toEqual([]);
  } finally {
    await sql.end();
    await database.stop();
  }
});

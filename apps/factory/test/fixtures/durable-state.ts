// Controlled journal inspection and corruption for adapter/recovery contract tests.
// External protocol fixtures and Git scratch files remain ordinary filesystem data.
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { recordNames, records } from '../../src/platform/index.js';
function databaseFor(path: string) {
  let directory = resolve(path);
  for (;;) {
    if (existsSync(join(directory, 'factory.sqlite'))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}
function isRecord(path: string) {
  const root = databaseFor(path);
  if (!root || !path.endsWith('.json')) return false;
  const key = relative(root, path);
  if (['joins', 'planner'].includes(basename(root))) return true;
  return (
    /^(?:joins|planner|issue-[1-9]\d*)\//.test(key) ||
    /^(?:intent|launch-claimed|stage-\d+(?:-claimed|-run(?:-\d+)?)?|(?:control|wait|schedule|planner)-\d+)\.json$/.test(
      key
    )
  );
}
function withRecord<A>(
  path: string,
  work: (db: ReturnType<typeof drizzle>, namespace: string, name: string) => A
) {
  const root = databaseFor(path);
  if (!root) throw new Error('Missing test database');
  const client = new Database(join(root, 'factory.sqlite'));
  try {
    return work(drizzle(client), relative(root, dirname(path)), basename(path));
  } finally {
    client.close();
  }
}
const missing = () => Object.assign(new Error('Missing test record'), { code: 'ENOENT' });
export function readFile(path: string, encoding: 'utf8'): Promise<string>;
export function readFile(path: string): Promise<Buffer>;
export async function readFile(path: string, encoding?: 'utf8'): Promise<string | Buffer> {
  if (!isRecord(path)) return encoding ? fs.readFile(path, encoding) : fs.readFile(path);
  const row = withRecord(path, (db, namespace, name) =>
    db
      .select()
      .from(records)
      .where(and(eq(records.namespace, namespace), eq(records.name, name)))
      .get()
  );
  if (!row) throw missing();
  const text = JSON.stringify(row.value);
  return encoding ? text : Buffer.from(text);
}
export async function writeFile(
  path: string,
  data: string | Buffer,
  options?: Parameters<typeof fs.writeFile>[2]
) {
  if (!isRecord(path)) return fs.writeFile(path, data, options);
  withRecord(path, (db, namespace, name) =>
    db
      .insert(records)
      .values({ namespace, name, value: JSON.parse(data.toString()) })
      .onConflictDoUpdate({
        target: [records.namespace, records.name],
        set: { value: JSON.parse(data.toString()) },
      })
      .run()
  );
}
export async function readdir(path: string) {
  if (!databaseFor(path)) return fs.readdir(path);
  const names = await recordNames(path);
  const physical = await fs.readdir(path).catch(() => []);
  return [
    ...new Set([
      ...names,
      ...physical.filter((name) => !name.endsWith('.json') && !name.startsWith('factory.sqlite')),
    ]),
  ].sort();
}
export async function unlink(path: string) {
  if (!isRecord(path)) return fs.unlink(path);
  const result = withRecord(path, (db, namespace, name) =>
    db
      .delete(records)
      .where(and(eq(records.namespace, namespace), eq(records.name, name)))
      .run()
  );
  if (!result.changes) throw missing();
}
export async function rename(source: string, target: string) {
  if (!isRecord(source)) return fs.rename(source, target);
  const data = await readFile(source, 'utf8');
  if (target.endsWith('.json')) await writeFile(target, data);
  else await fs.writeFile(target, data);
  await unlink(source);
}

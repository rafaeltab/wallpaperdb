import { existsSync, mkdirSync, readdirSync, readFileSync, chmodSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { records, metadata } from './schema.js';
import {
  journalIntent,
  journalLayer,
  journalLanding,
  controlSchema,
  intentSchema,
  plannerSchema,
  scheduleSchema,
  stageSchema,
  waitSchema,
} from './record-schemas.js';

const filename = 'factory.sqlite';
function rootFor(directory: string) {
  let current = resolve(directory);
  for (;;) {
    if (existsSync(join(current, filename))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(directory);
    current = parent;
  }
}
function validate(namespace: string, name: string, value: unknown) {
  const revision = /^(control|wait|schedule|planner)-(\d+)\.json$/.exec(name);
  if (revision) {
    const schemas = {
      control: controlSchema,
      wait: waitSchema,
      schedule: scheduleSchema,
      planner: plannerSchema,
    };
    const schema = schemas[revision[1] as keyof typeof schemas];
    const parsed = schema.parse(value);
    if (parsed.revision !== Number(revision[2])) throw new Error('Invalid record revision');
  } else if (name === 'intent.json') {
    if (
      namespace
        .split('/')
        .some(
          (part) => part === 'joins' || /^[a-f0-9]{64}$/.test(part) || part.startsWith('repair-')
        )
    )
      journalIntent.parse(value);
    else intentSchema.parse(value);
  } else if (name === 'seed.json') z.array(journalLayer).parse(value);
  else if (name === 'landing.json') journalLanding.parse(value);
  else if (/^stage-\d+\.json$/.test(name)) {
    const parsed = stageSchema.parse(value);
    if (parsed.index !== Number(name.split('-')[1].slice(0, -5)))
      throw new Error('Invalid stage index');
  } else if (/^stage-\d+-run(?:-\d+)?\.json$/.test(name))
    stageSchema.extend({ runId: z.string().min(1) }).parse(value);
  else if (value === null || typeof value !== 'object')
    throw new Error(`Invalid legacy record: ${name}`);
}
function stateNamespace(namespace: string, name: string) {
  const parts = namespace.split('/').filter(Boolean);
  if (parts.includes('recovery')) return /^[a-f0-9]{64}$/.test(name);
  if (name === 'recovery') return true;
  if (parts.includes('manual')) return /^(?:[1-9]\d*|[a-f0-9]{40})$/.test(name);
  return /^(?:issue-[1-9]\d*|planner|joins|manual|[a-f0-9]{64}|repair-(?:replay|owner)-[a-f0-9]{64}-(?:(?:[a-f0-9]{40}|initial)-)?[a-f0-9]{40})$/.test(
    name
  );
}
function legacy(
  root: string,
  namespace = ''
): { namespace: string; name: string; value: unknown }[] {
  const result: { namespace: string; name: string; value: unknown }[] = [];
  const directory = join(root, namespace);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue; // Unpublished crash debris has no authority.
    if (entry.name === filename) {
      if (namespace)
        throw new Error('Nested SQLite database requires explicit state-root reconciliation');
      continue;
    }
    if (entry.isSymbolicLink()) throw new Error('Symlinks are not supported in durable state');
    if (entry.isDirectory()) {
      // Git replay worktrees are scratch space, not journal namespaces.
      if (!stateNamespace(namespace, entry.name)) continue;
      result.push(...legacy(root, join(namespace, entry.name)));
    } else if (entry.name.endsWith('.json') && entry.name !== 'format.json') {
      if (
        !namespace &&
        !/^(?:intent|launch-claimed|stage-\d+(?:-claimed|-run(?:-\d+)?)?|(?:control|wait|schedule|planner)-\d+)\.json$/.test(
          entry.name
        )
      )
        continue;
      const value: unknown = JSON.parse(readFileSync(join(directory, entry.name), 'utf8'));
      validate(namespace, entry.name, value);
      result.push({ namespace, name: entry.name, value });
    }
  }
  for (const kind of ['control', 'wait', 'schedule', 'planner']) {
    const revisions = result
      .filter((r) => r.namespace === namespace && new RegExp(`^${kind}-\\d+\\.json$`).test(r.name))
      .map((r) => Number(r.name.slice(kind.length + 1, -5)))
      .sort((a, b) => a - b);
    if (revisions.some((revision, index) => revision !== index))
      throw new Error('Incomplete legacy revision history');
  }
  return result;
}
function connection<A>(
  directory: string,
  work: (db: ReturnType<typeof drizzle>, namespace: string) => A,
  migrateSchema = false
): A {
  const root = rootFor(directory);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const client = new Database(join(root, filename));
  try {
    chmodSync(join(root, filename), 0o600);
    client.pragma('busy_timeout = 10000');
    client.pragma('synchronous = FULL');
    const db = drizzle(client);
    const hasMetadata = client
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'metadata'")
      .get();
    const format = hasMetadata
      ? db.select().from(metadata).where(eq(metadata.key, 'format')).get()?.value
      : undefined;
    if (format !== undefined && format !== '2') throw new Error('Unsupported SQLite state format');
    if (!hasMetadata || migrateSchema)
      migrate(db, {
        migrationsFolder:
          ['../../drizzle', '../drizzle', './drizzle']
            .map((path) => fileURLToPath(new URL(path, import.meta.url)))
            .find((path) => existsSync(join(path, 'meta/_journal.json'))) ?? '',
      });
    if (format === undefined)
      db.transaction(
        (tx) => {
          if (tx.select().from(metadata).where(eq(metadata.key, 'format')).get()?.value === '2')
            return;
          const manifest = join(root, 'format.json');
          if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).format !== 1)
            throw new Error('Unsupported legacy format');
          const imported = legacy(root);
          for (const record of imported) tx.insert(records).values(record).run();
          if (tx.select().from(records).all().length !== imported.length)
            throw new Error('Incomplete import');
          tx.insert(metadata).values({ key: 'format', value: '2' }).run();
        },
        { behavior: 'immediate' }
      );
    return work(db, relative(root, resolve(directory)));
  } finally {
    client.close();
  }
}
/** Open, migrate and import only. No external reconciliation or worker launch. */
export function initializeState(directory: string, migrateSchema = false) {
  return connection(
    directory,
    (db) => ({
      format: 2,
      records: db.select().from(records).all().length,
    }),
    migrateSchema
  );
}
export function publisher(directory: string) {
  return async (name: string, value: unknown) =>
    connection(directory, (db, namespace) => {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const revision = /^(control|wait|schedule|planner)-(\d+)\.json$/.exec(name);
      return db.transaction(
        (tx) => {
          if (
            revision &&
            Number(revision[2]) > 0 &&
            !tx
              .select()
              .from(records)
              .where(
                and(
                  eq(records.namespace, namespace),
                  eq(records.name, `${revision[1]}-${Number(revision[2]) - 1}.json`)
                )
              )
              .get()
          )
            return false;
          return (
            tx.insert(records).values({ namespace, name, value }).onConflictDoNothing().run()
              .changes === 1
          );
        },
        { behavior: 'immediate' }
      );
    });
}
export async function readRecord(directory: string, name: string): Promise<unknown | null> {
  return connection(
    directory,
    (db, namespace) =>
      db
        .select()
        .from(records)
        .where(and(eq(records.namespace, namespace), eq(records.name, name)))
        .get()?.value ?? null
  );
}
export async function requiredRecord(directory: string, name: string): Promise<unknown> {
  const value = await readRecord(directory, name);
  if (value === null) throw Object.assign(new Error('Missing durable record'), { code: 'ENOENT' });
  return value;
}
export async function recordNames(directory: string): Promise<string[]> {
  return connection(directory, (db, namespace) => {
    const prefix = namespace ? namespace + '/' : '';
    return [
      ...new Set(
        db
          .select()
          .from(records)
          .all()
          .flatMap((row) =>
            row.namespace === namespace
              ? [row.name]
              : row.namespace.startsWith(prefix)
                ? [row.namespace.slice(prefix.length).split('/')[0]]
                : []
          )
      ),
    ].sort();
  });
}
export async function replaceProgress(directory: string, value: unknown) {
  connection(directory, (db, namespace) =>
    db
      .insert(records)
      .values({ namespace, name: 'recovery-progress.json', value })
      .onConflictDoUpdate({ target: [records.namespace, records.name], set: { value } })
      .run()
  );
}

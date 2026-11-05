import { publisher, initializeState, readRecord } from '../../src/platform/index.js';
import Database from 'better-sqlite3';
import { join } from 'node:path';
const [directory, mode] = process.argv.slice(2);
if (mode === 'interrupt') {
  const db = new Database(join(directory, 'factory.sqlite'));
  db.exec("BEGIN IMMEDIATE; INSERT INTO records VALUES ('', 'interrupted.json', '{}')");
  process.exit(7);
} else if (mode === 'read') {
  for (let index = 0; index < 200; index++) await readRecord(directory, 'launch-claimed.json');
  console.log('read complete');
} else if (mode === 'claim') {
  console.log(await publisher(directory)('launch-claimed.json', { version: 1 }));
} else console.log(JSON.stringify(initializeState(directory)));

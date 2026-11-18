import 'dotenv/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { decodeConfirmation } from '../src/adapters/asset-workflow/index.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString });
try {
  await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
  // Run with service writers stopped. Keyset batches bound memory; no payload or
  // notification/recovery identity is rewritten, including malformed evidence.
  let after = '';
  for (;;) {
    const { rows } = await pool.query<{ id: string; payload: string }>(
      'SELECT id,payload FROM wallpaper_workflow_quarantine WHERE id > $1 ORDER BY id LIMIT 100',
      [after]
    );
    if (!rows.length) break;
    for (const row of rows) {
      const decoded = decodeConfirmation(new TextEncoder().encode(row.payload));
      const reference = decoded.kind === 'created' ? decoded.result.wallpaperId : null;
      const asset = decoded.kind === 'source' ? decoded.confirmation.assetId : null;
      await pool.query(
        'UPDATE wallpaper_workflow_quarantine SET application_reference=$2,asset_id=$3 WHERE id=$1',
        [row.id, reference, asset]
      );
      after = row.id;
    }
  }
} finally {
  await pool.end();
}

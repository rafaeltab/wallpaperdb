import 'dotenv/config';
import { Pool } from 'pg';

// Deployment-only backfill. Ordinary Source transactions never hydrate legacy history.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('LOCK TABLE asset_source_state IN EXCLUSIVE MODE');
  await client.query(`INSERT INTO source_candidates (asset_id, id, replay_key, position, source_id, live_until, candidate)
    SELECT asset_id, candidate->>'candidateId', candidate->>'idempotencyKey', (position - 1)::int,
      candidate->>'sourceId', CASE WHEN candidate->>'status' IN ('accepted','rejected','cancelled')
        THEN NULL ELSE (candidate->>'expiresAt')::timestamptz END, candidate
    FROM asset_source_state, jsonb_array_elements(state->'candidates') WITH ORDINALITY AS history(candidate, position)`);
  await client.query(`UPDATE asset_source_state SET state =
    jsonb_set(jsonb_set(state, '{candidateSequence}', to_jsonb(jsonb_array_length(state->'candidates'))), '{candidates}', '[]')
    WHERE jsonb_array_length(state->'candidates') > 0`);
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}

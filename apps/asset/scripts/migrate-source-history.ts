import { Pool } from 'pg';

// Deployment migration only. Request processing never traverses the legacy history blob.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('LOCK TABLE owned_assets, asset_source_state IN EXCLUSIVE MODE');
  await client.query(`INSERT INTO source_candidates
    (id, asset_id, ordinal, idempotency_key, source_id, status, expires_at, candidate)
    SELECT c->>'candidateId', asset_id, (position-1)::integer,
      c->>'idempotencyKey', c->>'sourceId', c->>'status', (c->>'expiresAt')::timestamptz, c
    FROM asset_source_state, jsonb_array_elements(state->'candidates') WITH ORDINALITY AS history(c, position)`);
  await client.query(`UPDATE asset_source_state
    SET next_candidate_ordinal = jsonb_array_length(state->'candidates'),
        state = jsonb_set(state, '{candidates}', '[]')
    WHERE jsonb_array_length(state->'candidates') > 0`);
  await client.query('COMMIT');
} catch (cause) {
  await client.query('ROLLBACK');
  throw cause;
} finally {
  client.release();
  await pool.end();
}

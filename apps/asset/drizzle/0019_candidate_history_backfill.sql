-- Backfill every retained replay identity and its old zero-based cursor position before
-- removing history from the per-Asset membership row. This migration runs once.
INSERT INTO source_candidates (asset_id, candidate_id, idempotency_key, source_id, position, expires_at, pending, candidate)
SELECT asset_id, candidate->>'candidateId', candidate->>'idempotencyKey', candidate->>'sourceId', ordinal - 1,
  (candidate->>'expiresAt')::timestamptz,
  candidate->>'status' NOT IN ('accepted', 'rejected', 'cancelled'), candidate
FROM asset_source_state, jsonb_array_elements(state->'candidates') WITH ORDINALITY AS history(candidate, ordinal);
--> statement-breakpoint
UPDATE asset_source_state SET state = jsonb_set(state, '{candidates}', '[]'::jsonb);

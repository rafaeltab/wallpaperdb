-- One-time conversion preserves replay records and their existing cursor positions.
INSERT INTO source_candidates (asset_id, candidate_id, idempotency_key, position, expires_at, status, candidate)
SELECT s.asset_id, c.value->>'candidateId', c.value->>'idempotencyKey', c.ordinality - 1,
       (c.value->>'expiresAt')::timestamptz, c.value->>'status', c.value
FROM asset_source_state s
CROSS JOIN LATERAL jsonb_array_elements(s.state->'candidates') WITH ORDINALITY c(value, ordinality);
--> statement-breakpoint
UPDATE asset_source_state
SET candidate_sequence = jsonb_array_length(state->'candidates'),
    state = jsonb_set(state, '{candidates}', '[]'::jsonb);

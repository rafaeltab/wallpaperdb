INSERT INTO "source_candidates" (
  "asset_id", "candidate_id", "idempotency_key", "source_id", "expires_at", "terminal", "candidate"
)
SELECT state."asset_id", entry.candidate->>'candidateId', entry.candidate->>'idempotencyKey',
  entry.candidate->>'sourceId', (entry.candidate->>'expiresAt')::timestamptz,
  entry.candidate->>'status' IN ('accepted', 'rejected', 'cancelled'), entry.candidate
FROM "asset_source_state" state
CROSS JOIN LATERAL jsonb_array_elements(state."state"->'candidates') WITH ORDINALITY AS entry(candidate, position)
ORDER BY state."asset_id", entry.position;
--> statement-breakpoint
UPDATE "asset_source_state"
SET "state" = jsonb_set("state", '{candidates}', '[]'::jsonb);

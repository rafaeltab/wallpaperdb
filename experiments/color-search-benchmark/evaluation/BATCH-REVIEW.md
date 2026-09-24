# Batch color preference review

Open **http://zerotwo:8222/** to review all 24 comparisons at your own pace. The batch includes the previously pending green/red query and 23 additional comparisons using 62 distinct images from the shared library.

**Submitted:** all 24 rankings were received on 2026-09-19. [Results](batch-001-results.md) include the user's whole-batch quick-review caveat and five specifically uncertain pairs. These are one person's development preferences; no numerical confidence or population consensus is inferred. The interface remains available for optional revisions.

## Reviewing

Choose images in preferred order, tie images when appropriate, or mark a comparison as uncertain, skipped or having no good match. Notes are optional. Partial rankings leave omitted images unjudged; they do not rank them last. “None matches” can coexist with a relative ranking.

The browser saves progress for this batch and version on this browser origin. Returning to the same address restores that draft. Local browser data is not a backup: use **Submit answers** to save a durable server copy. You can submit a partial batch, return to it and submit a later revision. Notes-only responses are preserved without inventing uncertainty or an order. JSON export is available if submission fails.

The page uses fixed shuffled labels and complete original images. Source attributions are available without showing candidate percentages, algorithm scores or prior judgments. Submitted answers do not automatically become a numerical relevance grade.

## Running and checking

From the repository root:

```sh
make color-review-serve
make color-review-test
```

The review server defaults to port 8222, binds to `0.0.0.0`, and operates independently of the historical search prototype on 8221. `COLOR_REVIEW_PORT` overrides the port; `COLOR_REVIEW_STORAGE` overrides the response directory. It serves only the review interface, its batch JSON and the images referenced by that batch. It does not call OpenSearch, extract features or rank images.

### Current background service

On 2026-09-19 the previous server was found stopped and relaunched as `wallpaperdb-color-review.service` under the systemd user manager. This runs independently of the chat command session and restarts on process failure. To inspect or restart the existing service:

```sh
systemctl --user status wallpaperdb-color-review.service
systemctl --user restart wallpaperdb-color-review.service
```

Do not also start the foreground Make target while this service holds port 8222. The unit is transient; after a host reboot, launch it again from the repository root:

```sh
systemd-run --user --unit=wallpaperdb-color-review \
  --description='WallpaperDB color preference review (port 8222)' \
  --property=Restart=on-failure --property=RestartSec=3 \
  --working-directory="$PWD" --setenv=PATH="$PATH" \
  /usr/bin/make color-review-serve
```

Restoration checks returned HTTP 200 for `http://127.0.0.1:8222/` and `http://zerotwo:8222/`. This verifies the local tailnet route; it does not test a separate remote computer.

## Durable responses

Default directory:

`/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/reviews/color-review-batch-001/`

Each successful submission creates an immutable `<submissionId>.json` record with:

- The submitted answer statuses, rank groups, optional notes and timestamps.
- A complete batch snapshot, including query text, labels, source IDs and image hashes.
- The batch checksum, receipt timestamp and submission fingerprint.

Files are written and synced before success is returned. Retrying the same submission ID and content is idempotent. Different content requires a new ID; previous records are never overwritten. Revisions from the same reviewer are not independent annotators. When interpreting several submissions, retain their history and inspect which cases changed; a partial submission does not erase answers omitted from it. Cross-device drafts are not automatically synchronized.

Browser autosave alone does not send answers to the server. After the user submits, read these files to record findings without requiring a pasted response for every comparison. Browser QA uses an alternate temporary response directory so test answers do not enter this collection.

## Evaluation scope

[batch-001.json](batch-001.json) is the unchanged versioned presentation manifest; [batch-001.md](batch-001.md) records selection and evidence limits. The now-judged `composition-green-red-real-002` remains the same logical case in both its standalone record and batch slot 1. The previous 13 judged records remain intact, for 37 logical judgment records including this batch; repeated images and one reviewer do not make these independent samples.

This interface collects human annotations. It does not select a search method, implement the deferred algorithm-evaluation harness, calculate relevance scores or run performance benchmarks. Keep related queries and reused images together when designing later evaluation splits.

## Verification, 2026-09-18

Four backend tests cover response semantics, invalid inputs, durable snapshots, concurrent identical retries, overwrite prevention, cross-origin writes and read-path restrictions. Browser checks loaded all 24 cases and all displayed original images; checked desktop/mobile layout; exercised tied and partial rankings, explicit mismatch, notes-only, skips and uncertainty; restored drafts after reload; submitted and read answers back from disk; and retried without duplicate files. The HTTP tailnet hostname was used, including the UUID fallback needed outside a secure browser context.

Simulated offline submission retained the draft. Two real tabs confirmed stale edits cannot overwrite another tab's browser draft, while the current tab's answers remain submittable. An invalid first stored answer did not prevent recovery of later valid answers, and the raw original remained available separately. Notes have a 6,000-character limit; the server accommodates a full batch of such notes.

QA used port 8223 and `/tmp/wallpaperdb-batch-review-qa-20260918`, separate from human annotation storage. The main review remains on 8222. Existing services on 8220/8221 were preserved. These checks verify the annotation workflow, not any search algorithm's relevance or scalability.

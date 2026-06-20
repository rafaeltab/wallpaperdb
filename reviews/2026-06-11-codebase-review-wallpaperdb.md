# Codebase Review — wallpaperdb full repository

Date: 2026-06-11
Scope: Full-repository focused manual codebase health review of `/home/rafaeltab/wallpaperdb`, including explicit code coverage review
Mode: Focused manual review with delegated cartography and specialist read-only slices

## Executive summary

- Severity counts: Critical 0, High 4, Medium 8, Low 3, Observations 1.
- Top findings: [F-001](#f-001-upload-event-processing-is-not-idempotent-or-order-independent), [F-002](#f-002-media-acknowledges-out-of-order-variant-events-and-loses-them), [F-003](#f-003-graphql-pagination-can-drive-arbitrarily-large-opensearch-requests), and [F-004](#f-004-post-auth-redirects-accept-arbitrary-destinations) are the most decision-relevant risks because they affect correctness, reliability, resource control, and auth-adjacent safety.
- Main pain sources: event-driven consistency/idempotency boundaries, GraphQL guardrails that exist but are incomplete, shallow/degraded operability contracts, and uneven coverage of critical web/error/event-ordering paths.
- Caveats: specialists did not install dependencies or mutate code; tests/coverage commands that write artifacts were not run. Coverage conclusions use existing artifacts/logs, source/test inspection, and static evidence.

Findings below are decision candidates, not accepted work.

## Triage overview

| Severity | Count | Items |
| --- | ---: | --- |
| Critical | 0 | None |
| High | 4 | [F-001](#f-001-upload-event-processing-is-not-idempotent-or-order-independent), [F-002](#f-002-media-acknowledges-out-of-order-variant-events-and-loses-them), [F-003](#f-003-graphql-pagination-can-drive-arbitrarily-large-opensearch-requests), [F-004](#f-004-post-auth-redirects-accept-arbitrary-destinations) |
| Medium | 8 | [F-005](#f-005-gateway-enrichment-events-can-race-or-be-clobbered-around-base-document-creation), [F-006](#f-006-stuck-upload-recovery-can-create-unpublishable-stored-records), [F-007](#f-007-query-complexity-costs-are-mostly-ineffective), [F-008](#f-008-rate-limit-identity-is-fragile-behind-ingress), [F-009](#f-009-gateway-opensearch-index-config-is-documented-but-ignored), [F-010](#f-010-readiness-does-not-check-critical-dependency-health), [F-011](#f-011-web-route-and-hook-coverage-misses-critical-failure-paths), [F-012](#f-012-upload-client-still-submits-a-demo-userid-contract) |
| Low | 3 | [F-013](#f-013-health-returns-http-200-for-degraded-dependency-state), [F-014](#f-014-turbo-cache-inputs-reference-package-lockjson-in-a-pnpm-repo), [F-015](#f-015-cursor-hardening-is-functional-but-loose) |
| Observation | 1 | [O-001](#o-001-orphaned-minio-reconciliation-is-explicitly-non-paginated) |

Top findings to inspect first:

- [F-001](#f-001-upload-event-processing-is-not-idempotent-or-order-independent) — High, High confidence: duplicate/replayed upload events can fan out into duplicate variants or clobber Gateway projections.
- [F-002](#f-002-media-acknowledges-out-of-order-variant-events-and-loses-them) — High, High confidence: independent durable consumers can permanently lose variants when variant events beat parent wallpaper events.
- [F-003](#f-003-graphql-pagination-can-drive-arbitrarily-large-opensearch-requests) — High, High confidence: GraphQL `first`/`last` values reach OpenSearch request size without a hard runtime cap.
- [F-004](#f-004-post-auth-redirects-accept-arbitrary-destinations) — High, Medium-high confidence: sign-in/sign-up redirect handling appears to allow external post-auth destinations.

Main pain sources:

- Event semantics are at-least-once/order-variable, but downstream handlers are not consistently idempotent, commutative, or buffered.
- GraphQL safety mechanisms are present, but runtime constraints and identity assumptions have gaps.
- Operability endpoints blur liveness/readiness/dependency-health semantics.
- Existing tests and coverage artifacts cover many components, but several high-risk routes, hooks, event-ordering scenarios, and recovery edge cases are uncovered.

Confidence/evidence caveats:

- Findings are based on source evidence, existing test/coverage artifacts, and cheap Git churn; no services were started and no tests were re-run.
- Specialist summaries were used as primary evidence. The top-level synthesis merged only overlapping Gateway/event-ordering findings and preserved uncertainty where runtime deployment behavior could change impact.
- Existing coverage artifacts under `apps/web/coverage` were inspected only for the approved coverage lens; generated/cache/build outputs were otherwise skipped.

## Scope and method

- Reviewed: root workspace metadata, README/service docs, selected service source/test/schema/config files, event schemas/consumers, GraphQL safety paths, web auth/upload/browse paths, existing coverage artifacts/logs, Docker Compose/Caddy/Makefile/Turbo config, and cheap Git status/churn.
- Not reviewed: every source file, generated/build/cache outputs except relevant coverage artifacts, production deployment beyond local Compose, local secret `.env` contents, full runtime behavior under Caddy, or all docs pages.
- Side effects: exactly this report artifact was written. No code/docs/config/test/CI/dependency changes, commits, issues, ADRs, or PR comments were created.
- Synthesis basis: delegated cartography manifest plus three specialist manifests/reports. The top-level synthesis used specialist evidence and did not redo broad raw-file archaeology.

## Findings / observations

### F-001: Upload event processing is not idempotent or order-independent

- ID: F-001
- Area: Ingestor, `packages/events`, Variant Generator, Media, Gateway projection
- Severity: High
- Severity justification: Duplicate/replayed upload events affect the core upload-to-processing path and can create duplicate downstream artifacts or erase enriched read-model data.
- Confidence: High
- Evidence strength: Source evidence; Git history or churn; heuristic pattern evidence
- Churn signal: recent churn seen in event/reconciliation paths; specialist command saw 5 relevant commits in the last 90 days.
- Summary: The pipeline uses at-least-once consumers and replay/reconciliation paths, but several downstream handlers treat `wallpaper.uploaded` as if it were single-delivery and in-order.
- Evidence: Specialist 1 reported that Ingestor publishes before transitioning state in `apps/ingestor/src/services/upload/upload-orchestrator.service.ts:244-290`; missing-events reconciliation republishes eligible `stored` rows in `apps/ingestor/src/services/reconciliation/missing-events-reconciliation.service.ts:31-61`; `packages/events/src/consumer/base-event-consumer.ts:335-375` provides retries/max delivery but no event-id dedupe store; Variant Generator regenerates and republishes variants on duplicate uploaded events in `apps/variant-generator/src/services/variant-generator.service.ts:81-104`; Media inserts variants with random `var_${ulid()}` and no natural uniqueness in `apps/media/src/services/consumers/wallpaper-variant-uploaded-consumer.service.ts:71-90` and `apps/media/src/db/schema.ts:29-60`; Gateway `wallpaper.uploaded` full-indexes with `variants: []` in `apps/gateway/src/consumers/wallpaper-uploaded.consumer.ts:49-56` and `apps/gateway/src/repositories/wallpaper.repository.ts:61-66`.
- Impact: A single duplicate upload event can fan out into duplicate variants and later read-model clobbering. The most damaging path is a duplicate `wallpaper.uploaded` arriving after variants/colors, replacing the Gateway document with a base version that loses enrichment.
- Suggested next decisions: Accept and create an issue; document event delivery semantics; make downstream handlers idempotent/commutative; add natural uniqueness or handled-event records; add regression tests for duplicate `wallpaper.uploaded` after variants/colors exist; or launch deeper research if the intended event guarantees differ.

### F-002: Media acknowledges out-of-order variant events and loses them

- ID: F-002
- Area: Media service event consumers
- Severity: High
- Severity justification: Losing variant events breaks availability of processed media on a core workflow and can happen under ordinary event-order variation.
- Confidence: High
- Evidence strength: Source evidence
- Churn signal: not separately checked beyond pipeline churn.
- Summary: Media starts independent durable consumers for parent and variant events. If a variant event arrives before its parent wallpaper row, the consumer returns successfully, which acknowledges and drops the event.
- Evidence: Specialist 1 reported independent consumers in `apps/media/src/app.ts:119-128`; parent-missing branch returns successfully in `apps/media/src/services/consumers/wallpaper-variant-uploaded-consumer.service.ts:62-69`; base consumer acknowledges successful handlers in `packages/events/src/consumer/base-event-consumer.ts:335-340`; Media schema has no pending-variant table in `apps/media/src/db/schema.ts:7-60`.
- Impact: Out-of-order delivery can permanently omit variants from Media, causing media URLs or variants to be unavailable even though processing succeeded elsewhere.
- Suggested next decisions: Accept and create an issue; treat missing parent as retryable for bounded time; persist pending variant events; include enough parent metadata in variant events to upsert parent; add out-of-order Media event tests.

### F-003: GraphQL pagination can drive arbitrarily large OpenSearch requests

- ID: F-003
- Area: Gateway GraphQL search and OpenSearch repository
- Severity: High
- Severity justification: An unauthenticated or low-cost query path can create large backend requests and resource pressure on an important read API.
- Confidence: High
- Evidence strength: Source evidence
- Churn signal: recent churn seen: specialist reported `wallpaper.repository.ts` changed 4 times and `resolvers.ts` 2 times in last 90 days.
- Summary: GraphQL exposes `first`/`last` integers, resolver code uses them directly as `limit`, and OpenSearch receives `size: limit + 1` without an explicit positive max page-size guard.
- Evidence: `apps/gateway/src/graphql/schema.ts:217-235` exposes `first`/`last`; `apps/gateway/src/graphql/resolvers.ts:106-150` computes and forwards `limit`; `apps/gateway/src/repositories/wallpaper.repository.ts:221-224` and `:318` use that size in OpenSearch; `apps/gateway/src/services/query-complexity.service.ts:134-148` caps complexity multiplier for scoring but not actual runtime request size.
- Impact: Large, negative, zero, or conflicting pagination arguments can cause oversized OpenSearch requests, slow responses, memory pressure, or errors while bypassing intended cost controls.
- Suggested next decisions: Accept and create an issue; enforce exactly one direction, positive integers, max page size, and cursor-direction consistency at resolver/schema boundary; add security tests for too-large, zero/negative, mixed `first+last`, and cursor mismatch cases.

### F-004: Post-auth redirects accept arbitrary destinations

- ID: F-004
- Area: Web sign-in/sign-up flows
- Severity: High
- Severity justification: Auth-adjacent open redirects can enable phishing or trust-boundary confusion immediately after successful authentication.
- Confidence: Medium
- Evidence strength: Source evidence; Git history or churn
- Churn signal: recent auth churn seen on 2026-05-18 in specialist Git history.
- Summary: Sign-in and sign-up read `redirect` query strings directly and navigate to decorated URLs, while route validators only check type.
- Evidence: Specialist 2 reported `apps/web/src/components/sign-in-form.tsx:23-26` reads `redirect`; `apps/web/src/components/sign-in-form.tsx:36-44` uses Clerk `decorateUrl(redirectUrl)` and assigns `window.location.href` when URL starts with `http`; same pattern in `apps/web/src/components/sign-up-form.tsx:24-27`, `:43-51`, `:68-77`; route validators in `apps/web/src/routes/sign-in.tsx:7-9` and `apps/web/src/routes/sign-up.tsx:7-9` check type but not origin/path-only constraints.
- Impact: A crafted sign-in/sign-up URL may redirect authenticated users to an attacker-controlled site after auth, supporting phishing or account-confusion flows.
- Suggested next decisions: Accept and create an issue; restrict redirects to relative app paths, normalize against `VITE_BASE_PATH`, reject protocol/host-bearing and protocol-relative values, and add tests for malicious/malformed redirects. If Clerk behavior already constrains this at runtime, launch a focused repro before implementation.

### F-005: Gateway enrichment events can race or be clobbered around base document creation

- ID: F-005
- Area: Gateway projection, OpenSearch repository, event consumers
- Severity: Medium
- Severity justification: Search/read results can miss variants or colors, but the issue is bounded to projection consistency rather than primary stored media.
- Confidence: High
- Evidence strength: Source evidence
- Churn signal: included in event-pipeline churn.
- Summary: Gateway's variant/color consumers update existing documents, while the uploaded consumer writes a base document with empty enrichment fields. Out-of-order or repeated uploaded events can lose enrichment.
- Evidence: Specialist 1 reported separate Gateway consumers in `apps/gateway/src/app.ts` and consumer files; update-only enrichment paths in `apps/gateway/src/repositories/wallpaper.repository.ts:92-109` and `:139-158`; `wallpaper.uploaded` full-indexes with empty variants in `apps/gateway/src/consumers/wallpaper-uploaded.consumer.ts:49-56`; missing-doc updates rely on retry/max-delivery behavior in `packages/events/src/consumer/base-event-consumer.ts:363-375`.
- Impact: Gateway search/detail responses may miss available media variants/colors after valid events were processed elsewhere, creating inconsistent user-facing results.
- Suggested next decisions: Merge with F-001 if tracked together; make base upsert merge-preserving, use scripted/doc upserts, or model projection writes as commutative updates; add out-of-order and duplicate-after-enrichment tests.

### F-006: Stuck upload recovery can create unpublishable `stored` records

- ID: F-006
- Area: Ingestor recovery/reconciliation
- Severity: Medium
- Severity justification: Recovery paths can fail to recover valid uploads or move them into a state that later reconciliation cannot publish, creating operational cleanup/retry pain.
- Confidence: High
- Evidence strength: Source evidence
- Churn signal: event/reconciliation churn seen.
- Summary: Stuck upload recovery guesses an `original.jpg` key and transitions records to `stored` without reconstructing the metadata needed by missing-events publishing.
- Evidence: Specialist 1 reported `apps/ingestor/src/services/reconciliation/stuck-uploads-reconciliation.service.ts:49-65` constructs `${record.id}/original.jpg` and updates state/timestamp; `apps/ingestor/src/services/events.service.ts:47-59` requires full file metadata/storage fields to publish `wallpaper.uploaded`.
- Impact: Non-JPEG stuck uploads may be missed; recovered JPEG rows can become repeatedly unpublishable in missing-events reconciliation.
- Suggested next decisions: Accept and create an issue; persist intended storage key/extension earlier; list by wallpaper prefix; re-extract metadata before transitioning to `stored`; add tests for PNG/WebP and recovered publishability.

### F-007: Query complexity costs are mostly ineffective

- ID: F-007
- Area: Gateway GraphQL security controls
- Severity: Medium
- Severity justification: Weak complexity pricing reduces DoS protection, but depth/breadth/rate-limit layers still provide partial coverage.
- Confidence: High
- Evidence strength: Source evidence; runtime/test evidence from existing tests/comments
- Churn signal: low/not highlighted; security tests exist.
- Summary: The complexity service defines qualified cost keys, but the lookup returns only simple field names, so expensive operation costs fall back to defaults.
- Evidence: Specialist 3 reported cost map keys such as `Query.searchWallpapers`, `Wallpaper.variants`, `Variant.url` in `apps/gateway/src/services/query-complexity.service.ts:15-29`; `getFieldName()` returns `node.name.value` in `:122-129`; fallback/default behavior in `:44-56`; existing tests in `apps/gateway/test/graphql-security.test.ts:311-358` comment that practical rejection is not exercised with current schema/high limit.
- Impact: Complexity controls may appear stronger than they are, and expensive fields/search operations may be underpriced.
- Suggested next decisions: Accept and create an issue; make complexity parent-type-aware or switch to simple field keys intentionally; add tests that exceed limits and assert rejection.

### F-008: Rate-limit identity is fragile behind ingress

- ID: F-008
- Area: Gateway rate limiting, Caddy ingress
- Severity: Medium
- Severity justification: Misidentifying clients can either collapse all users into one bucket behind proxy or let bots multiply quota; impact depends on deployment topology.
- Confidence: Medium
- Evidence strength: Source evidence; heuristic pattern evidence
- Churn signal: specialist reported moderate churn in `infra/docker-compose.apps.yml` and `Makefile`.
- Summary: Gateway rate limit keys use request IP plus hashed User-Agent. Caddy reverse-proxies to the Gateway, and Fastify proxy trust was not visible in inspected app setup. Tests intentionally show User-Agent rotation gets a fresh allowance.
- Evidence: `apps/gateway/src/app.ts:52-70` creates Fastify without visible `trustProxy`; `infra/caddy/Caddyfile:42-44` reverse-proxies to `gateway:3004`; `apps/gateway/src/services/rate-limit.service.ts:86-95` keys by IP and User-Agent; `apps/gateway/test/graphql-security.test.ts:400-433` expects a changed User-Agent to get fresh allowance.
- Impact: Behind Caddy, client IP may be the proxy/container unless configured, collapsing limits. Direct clients can rotate User-Agent to multiply anonymous allowance.
- Suggested next decisions: Decide intended identity model; configure trusted proxy handling if needed; partition by stable client identity/IP, not User-Agent; keep User-Agent as metadata/risk signal only.

### F-009: Gateway OpenSearch index config is documented but ignored

- ID: F-009
- Area: Gateway config, OpenSearch index manager
- Severity: Medium
- Severity justification: Environment/test/worktree isolation can silently fail and contaminate shared indexes.
- Confidence: High
- Evidence strength: Source evidence; documentation mismatch
- Churn signal: specialist reported `index-manager.service.ts` changed once in last 90 days.
- Summary: Gateway config loads `OPENSEARCH_INDEX`, but the index manager hardcodes `wallpapers`.
- Evidence: Specialist 3 reported config schema/loader in `apps/gateway/src/config.ts:16-19`, `:67-70`; `.env.example` documents `OPENSEARCH_INDEX=wallpapers`; `apps/gateway/src/services/index-manager.service.ts:11-13` hardcodes `private readonly indexName = 'wallpapers'`; repository uses IndexManagerService for index name in `apps/gateway/src/repositories/wallpaper.repository.ts`.
- Impact: Operators may believe per-environment indexes are isolated while instances actually share one index.
- Suggested next decisions: Accept and create an issue; inject `config.opensearchIndex` into IndexManagerService; add a config test asserting env var changes index operations.

### F-010: Readiness does not check critical dependency health

- ID: F-010
- Area: Gateway/core health/readiness
- Severity: Medium
- Severity justification: Orchestration can keep routing traffic to instances unable to serve read queries or consume projections if dependencies fail after startup.
- Confidence: High
- Evidence strength: Source evidence
- Churn signal: not checked.
- Summary: Gateway `/ready` checks initialization/shutdown state only. Dependency checks exist but are used by `/health`, not readiness.
- Evidence: Specialist 3 reported `apps/gateway/src/routes/health.routes.ts:65-70`; `apps/gateway/src/services/health.service.ts:62-70`; `packages/core/src/health/health-aggregator.ts:143-164`; dependency health checks in `apps/gateway/src/services/health.service.ts:25-50`.
- Impact: A Gateway with broken OpenSearch/NATS can remain ready from the orchestrator's perspective.
- Suggested next decisions: Decide readiness contract; include critical dependency checks or recent health state in `/ready`; or document `/ready` as shallow and route/alert on dependency-aware `/health`.

### F-011: Web route and hook coverage misses critical failure paths

- ID: F-011
- Area: Web app tests/coverage, auth/upload/browse/detail flows
- Severity: Medium
- Severity justification: Critical user flows have known weak or missing coverage, increasing regression risk around auth redirects, detail errors, upload queue behavior, and browse hooks.
- Confidence: High
- Evidence strength: Tool output; source evidence; runtime/test evidence from existing logs
- Churn signal: recent web auth/upload churn seen.
- Summary: Existing web coverage artifacts show respectable coverage in some components but 0% or weak coverage in important route/hook paths; E2E covers login/upload only and does not generate code coverage.
- Evidence: Existing `apps/web/coverage/coverage-summary.json` modified 2026-06-11 reports overall web lines/statements 38.29%, functions 63.15%, branches 81.08%; strong coverage for sign-in/sign-up forms, upload drop-zone, ingestor API, GraphQL client, upload/index routes; 0% for `routes/sign-in.tsx`, `routes/sign-up.tsx`, `routes/wallpapers.$wallpaperId.tsx`, `hooks/useWallpaperInfiniteQuery.ts`, `hooks/useWallpaperQuery.ts`, `components/upload/upload-queue-toast-manager.tsx`; `contexts/upload-queue-context.tsx` has 50.84% lines. Existing logs show `apps/web/.turbo/turbo-test$colon$unit.log` with 296 passing tests and `apps/web-e2e/.turbo/turbo-test$colon$e2e.log` with 3 passing Playwright tests.
- Impact: Failures such as detail GraphQL errors being displayed as not-found, unsafe auth redirects, upload rate-limit resume/cancellation, and browse infinite-query edge cases can regress without tests catching them.
- Suggested next decisions: Accept and create targeted test issues; prioritize detail error/null/success, auth redirect sanitization, GraphQL hooks, upload queue provider async behavior, token-provider lifecycle, and browser E2E browse/detail/failure coverage.

### F-012: Upload client still submits a demo `userId` contract

- ID: F-012
- Area: Web upload client and Ingestor upload route contract
- Severity: Medium
- Severity justification: The immediate backend appears to derive identity from auth, but stale client-provided identity is misleading and could become an attribution/security bug if trusted later.
- Confidence: Medium
- Evidence strength: Source evidence
- Churn signal: recent upload/E2E churn seen on 2026-05-18.
- Summary: Web upload queue appends a hard-coded demo user ID to the multipart request, while Ingestor currently appears to derive user identity from auth instead.
- Evidence: `apps/web/src/contexts/upload-queue-context.tsx:16-17` defines `DEMO_USER_ID = 'user_demo_001'`; upload path calls `uploadWallpaperWithDetails(nextFile.file, DEMO_USER_ID)` in `:359-360`; `apps/web/src/lib/api/ingestor.ts:46-49` appends it; Ingestor derives user from auth in `apps/ingestor/src/routes/upload.routes.ts:32-43` and caches only file metadata in `:97-108`; web API tests assert arbitrary submitted `userId` in `apps/web/test/lib/api/ingestor.test.ts:177-191`.
- Impact: Tests and clients encode the wrong ownership boundary for user identity, raising future maintenance and security risk if the form field is later trusted.
- Suggested next decisions: Remove client-provided `userId` if server owns identity; or explicitly model/display Clerk user identity if needed; update tests to assert Authorization/token behavior and server-derived identity.

### F-013: `/health` returns HTTP 200 for degraded dependency state

- ID: F-013
- Area: Core health formatter, Gateway health route
- Severity: Low
- Severity justification: This primarily affects monitoring semantics and can be fixed or documented locally; `/ready` and `/health` contract decisions may supersede it.
- Confidence: High
- Evidence strength: Source evidence
- Churn signal: not checked.
- Summary: The core formatter maps degraded health to HTTP 200, so status-code-only monitors miss partial dependency failures.
- Evidence: Specialist 3 reported `packages/core/src/health/formatters.ts:6-15`; degraded aggregation in `packages/core/src/health/health-aggregator.ts:110-121`; Gateway route uses formatter in `apps/gateway/src/routes/health.routes.ts:36-41`.
- Impact: Monitoring systems that rely on status code only may not detect degraded dependency state.
- Suggested next decisions: Decide endpoint contract; return non-2xx for dependency-health degradation, or add separate `/live` and document `/health` as body-inspected dependency report.

### F-014: Turbo cache inputs reference `package-lock.json` in a pnpm repo

- ID: F-014
- Area: Turbo task graph/cache invalidation
- Severity: Low
- Severity justification: Stale cache risk can waste debugging time or hide dependency-sensitive failures, but the fix is localized.
- Confidence: High
- Evidence strength: Source evidence; tool output
- Churn signal: `turbo.json` changed 4 times in last 90 days.
- Summary: Turbo task inputs include nonexistent `package-lock.json` and omit `pnpm-lock.yaml` for several dependency-sensitive tasks.
- Evidence: Root `package.json` declares pnpm package manager; specialist search found no `package-lock.json`; `turbo.json:70-80`, `:131-149` include `package-lock.json` for `test`, `check-types`, and `gen:swagger` but not `pnpm-lock.yaml`.
- Impact: Dependency lockfile changes may not invalidate cached tests/typechecks/swagger generation.
- Suggested next decisions: Replace `package-lock.json` inputs with `pnpm-lock.yaml`, preferably as a global/task input for dependency-sensitive tasks.

### F-015: Cursor hardening is functional but loose

- ID: F-015
- Area: Gateway cursor signing/search-after
- Severity: Low
- Severity justification: HMAC signing and expiration already mitigate ordinary tampering; remaining concerns are hardening and malformed-state reduction.
- Confidence: Medium
- Evidence strength: Source evidence
- Churn signal: not checked.
- Summary: Cursor signatures are compared with normal string equality and payload shape is only loosely validated before reaching OpenSearch `search_after`.
- Evidence: Specialist 3 reported `apps/gateway/src/services/cursor.service.ts:45-53` compares `signature !== expectedSignature`; `:63-70` validates values only as array of strings/numbers; `apps/gateway/src/repositories/wallpaper.repository.ts:331-333` passes values to `search_after`.
- Impact: Low immediate risk, but constant-time comparison, cursor version/sort-mode/index identity, and tuple-shape validation would reduce boundary weirdness.
- Suggested next decisions: Use `crypto.timingSafeEqual` after length checks; include cursor version/sort mode/index identity; validate tuple arity/types per sort mode.

### O-001: Orphaned MinIO reconciliation is explicitly non-paginated

- ID: O-001
- Area: Ingestor cleanup/reconciliation
- Severity: Observation
- Severity justification: The implementation explicitly documents the limitation. It is worth tracking, but the review did not establish current bucket sizes or operational pain.
- Confidence: High
- Evidence strength: Source evidence
- Churn signal: not checked.
- Summary: Orphan cleanup processes a single `ListObjectsV2` page and contains comments noting pagination is unsupported.
- Evidence: Specialist 1 reported TODO/NOTE in `apps/ingestor/src/services/reconciliation/orphaned-minio-reconciliation.service.ts:21-23`, `:37-45`; single response processing in `:45-69`.
- Impact: Buckets with more than one S3 page can leave later orphaned objects unprocessed; cleanup completeness degrades as object count grows.
- Suggested next decisions: Accept as context; create a low/medium issue if bucket size makes it relevant; add continuation-token pagination and a mocked paginated-response test.

## Coverage rerun addendum — commands allowed

Rafael later approved rerunning the coverage slice with commands allowed. I ran the coverage/test commands directly and allowed generated coverage/test artifacts.

Execution notes:

- Initial root `pnpm test:coverage` failed because the root Vitest invocation did not apply package-specific environments and could not access a Docker runtime for Testcontainers. Failures included React/Muuri tests under Node without `document`/`MouseEvent`, and Testcontainers tests with `Could not find a working container runtime strategy`.
- I then exposed the Docker daemon from the existing LXD Docker host container through a temporary TCP proxy and reran Testcontainers-backed package commands with `DOCKER_HOST`, `TESTCONTAINERS_HOST_OVERRIDE`, and `TESTCONTAINERS_RYUK_DISABLED=true`.
- The targeted package/app coverage and E2E commands below passed. `pnpm coverage:merge` also completed and wrote `/home/rafaeltab/wallpaperdb/coverage/lcov.info`.
- No source files were modified. Git status after the rerun still showed only the pre-existing untracked AppArmor compose files plus this `reviews/` directory.

Commands that passed after rerun:

- `pnpm --filter @wallpaperdb/web test:unit` — 296 tests passed.
- `pnpm --filter @wallpaperdb/events test:unit` — 46 tests passed.
- `pnpm --filter @wallpaperdb/react-muuri test:unit` — 139 tests passed.
- `pnpm --filter @wallpaperdb/url-ipv4-resolver test:unit` — 4 tests passed.
- `pnpm --filter @wallpaperdb/core exec vitest run --coverage` — 170 tests passed.
- `pnpm --filter @wallpaperdb/auth exec vitest run --coverage` — 25 tests passed.
- `pnpm --filter @wallpaperdb/color-extractor test:integration` — 19 tests passed.
- `pnpm --filter @wallpaperdb/gateway test:integration` — 140 tests passed, 1 skipped.
- `pnpm --filter @wallpaperdb/ingestor test:integration` — 114 tests passed.
- `pnpm --filter @wallpaperdb/media test:integration` — 50 tests passed.
- `pnpm --filter @wallpaperdb/tags test:integration` — 2 tests passed.
- `pnpm --filter @wallpaperdb/user test:integration` — 1 test passed.
- `pnpm --filter @wallpaperdb/variant-generator test:integration` — 24 tests passed.
- `pnpm --filter @wallpaperdb/ingestor-e2e test:e2e` — 21 tests passed.
- `pnpm --filter @wallpaperdb/test-utils test:e2e` — 41 tests passed, 15 skipped.
- `pnpm --filter @wallpaperdb/testcontainers test:e2e` — 15 tests passed.
- `pnpm --filter @wallpaperdb/web-e2e test:e2e` — 3 Playwright tests passed.
- `pnpm coverage:merge` — merged direct `apps/*/coverage/lcov.info` and `packages/*/coverage/lcov.info` into `coverage/lcov.info`.

Direct coverage summaries from generated `coverage-summary.json` files:

| Package/app | Lines | Statements | Functions | Branches |
| --- | ---: | ---: | ---: | ---: |
| `apps/color-extractor` | 76.81% | 76.81% | 84.84% | 76.47% |
| `apps/gateway` | 88.04% | 88.04% | 94.56% | 87.78% |
| `apps/ingestor-e2e` | 85.14% | 85.14% | 100% | 67.50% |
| `apps/ingestor` | 83.13% | 83.13% | 74.04% | 83.64% |
| `apps/media` | 75.41% | 75.41% | 77.77% | 83.94% |
| `apps/tags` | 26.74% | 26.74% | 23.07% | 44.44% |
| `apps/user` | 0.00% | 0.00% | 36.36% | 36.36% |
| `apps/variant-generator` | 75.88% | 75.88% | 81.81% | 82.19% |
| `apps/web` | 38.29% | 38.29% | 63.15% | 81.08% |
| `packages/auth` | 93.80% | 93.80% | 100% | 87.50% |
| `packages/core` | 65.25% | 65.25% | 80.00% | 84.61% |
| `packages/events` | 76.50% | 76.50% | 50.00% | 64.86% |
| `packages/react-muuri` | 82.40% | 82.40% | 53.65% | 93.58% |
| `packages/test-utils` | 62.13% | 62.13% | 70.58% | 87.90% |
| `packages/testcontainers` | 93.70% | 93.70% | 88.88% | 78.26% |
| `packages/url-ipv4-resolver` | 93.47% | 93.47% | 100% | 62.06% |

Coverage gaps after executing commands:

- `apps/web` remains the biggest user-facing coverage concern at 38.29% line coverage. The earlier specific gaps still stand: detail route, sign-in/sign-up route wrappers, browse/detail hooks, upload queue manager/provider behavior, and failure states.
- `apps/user` reports 0% line/statement coverage despite one passing health test, so its service code is effectively not covered by the current integration suite.
- `apps/tags` is intentionally skeletal, but current coverage is still low at 26.74% lines.
- `packages/events` has only 50% function coverage and 64.86% branch coverage, which is notable given the event-contract/idempotency findings.
- `packages/react-muuri` has good line/branch coverage, but function coverage is 53.65%.
- `packages/core` and `packages/test-utils` have moderate line coverage; both are shared infrastructure packages where gaps can affect many services.
- Web E2E passed login/upload, but it still does not produce browser code coverage and still does not cover browse filters, infinite scroll, detail page, download/share, auth redirect hardening, or failure-state UX.
- Event pipeline tests now pass when Docker is reachable, but the review's missing scenario findings still stand: duplicate uploaded-after-enrichment, variant-before-parent, non-JPEG stuck uploads, recovered-record publishability, and paginated MinIO cleanup.
- GraphQL integration/security tests now pass when Docker is reachable, but the review's coverage gap still stands for explicit pagination caps and effective complexity rejection.

## Subagent manifests

### Subagent manifest — cartography

- Assigned scope: full-repository focused manual review of `/home/rafaeltab/wallpaperdb`; exclusions were no code/setup/tooling/docs/dependency/CI/git/issue/PR mutations.
- Review lens: cartography.
- Evidence inspected: Git tracked-file counts/status/logs/churn; root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, root `README.md`; service READMEs for Gateway/Ingestor/Web/Media/User/Tags/Variant Generator/Infra; `apps/color-extractor/package.json`; package metadata over `apps/*`, `packages/*`, `experiments/*`, `infra`; route/docs/test listings.
- Commands: cheap Git/file/package-metadata commands. Initial Node metadata command had a typo and was rerun successfully.
- Artifacts written: none.
- Findings/observations emitted: none; only map and review-slice candidates.
- Uncertainties: source internals and test quality/pass status were not deeply reviewed; README claims may be stale; generated/cache/coverage/build outputs skipped except later approved coverage lens.
- Out of scope / not inspected: running tests/builds/services, installing dependencies, full source review of every file, generated artifacts.
- Inherited or unverified context: user-approved scope and side-effect boundary; README/service-doc claims.
- Coverage confidence: medium-high for repository map; medium/low for behavioral correctness.

### Subagent manifest — specialist: event pipeline + persistence/recovery/testing gaps

- Assigned scope: upload-to-processing event pipeline plus persistence/recovery/testing gaps.
- Review lens: architecture/reliability/testing of event flow and persistence recovery.
- Evidence inspected: `packages/events/src/consumer/base-event-consumer.ts`, publisher and schema files; Ingestor upload orchestrator/state machine/events/reconciliation/scheduler/schema/app/index/test files; Variant Generator and Color Extractor consumers/processors; Media app/schema/repositories/consumers/events/migrations/tests; Gateway app/consumers/repository/tests.
- Commands: targeted file/content searches, `git status --short`, targeted `git log`, and a 90-day churn count over relevant event/reconciliation paths.
- Artifacts written: none.
- Findings/observations emitted: source findings that map to [F-001](#f-001-upload-event-processing-is-not-idempotent-or-order-independent), [F-002](#f-002-media-acknowledges-out-of-order-variant-events-and-loses-them), [F-005](#f-005-gateway-enrichment-events-can-race-or-be-clobbered-around-base-document-creation), [F-006](#f-006-stuck-upload-recovery-can-create-unpublishable-stored-records), [O-001](#o-001-orphaned-minio-reconciliation-is-explicitly-non-paginated).
- Uncertainties: tests were not executed; not every migration snapshot was inspected in full.
- Out of scope / not inspected: runtime containers/services, dependency install, all source files.
- Inherited or unverified context: cartography map and service responsibilities from docs.
- Coverage confidence: high for sampled event-order/idempotency/recovery signals; medium for whole-repo persistence coverage.

### Subagent manifest — specialist: web auth/upload/browse + code coverage

- Assigned scope: web auth/upload/browse flows plus explicit code coverage lens.
- Review lens: web flow correctness, auth-adjacent risk, coverage/test blind spots.
- Evidence inspected: web/root package scripts, Turbo/Vitest config, existing `apps/web/coverage/coverage-summary.json`, Turbo test logs, web routes/components/hooks/clients/context tests, selected Ingestor upload route source.
- Commands: Git status/branch, recent Git history for auth/upload/browse paths, `stat` on coverage/log artifacts, Node summary over existing coverage JSON. One coverage-summary command had shell quoting issue and was rerun successfully.
- Artifacts written: none.
- Findings/observations emitted: source/coverage findings that map to [F-004](#f-004-post-auth-redirects-accept-arbitrary-destinations), [F-011](#f-011-web-route-and-hook-coverage-misses-critical-failure-paths), [F-012](#f-012-upload-client-still-submits-a-demo-userid-contract), plus the detail-route error-ordering coverage signal included under [F-011](#f-011-web-route-and-hook-coverage-misses-critical-failure-paths).
- Uncertainties: coverage/test commands were not run because they write artifacts; runtime behavior of Clerk redirect decoration was not reproduced.
- Out of scope / not inspected: generated coverage internals beyond summaries/logs, all frontend components, E2E code coverage generation.
- Inherited or unverified context: cartography route/component map and coverage-lens approval.
- Coverage confidence: high for existing web coverage artifact interpretation; medium for full frontend behavioral risk.

### Subagent manifest — specialist: Gateway GraphQL safety + shared infra/contracts/operability

- Assigned scope: Gateway read model/GraphQL safety plus shared infra/contracts/operability.
- Review lens: GraphQL/resource/security controls, config/health/ingress/task graph.
- Evidence inspected: Gateway schema/resolvers/validation/cursor/rate-limit/complexity/color-sort/index-manager/health/repository/app/config/routes/tests; core config/health types/formatters; Gateway `.env.example`; Docker Compose/Caddy; root `Makefile`, `turbo.json`, `package.json`.
- Commands: targeted file/content searches, Git churn command for Gateway/core/infra files, `git status --short`.
- Artifacts written: none.
- Findings/observations emitted: source findings that map to [F-003](#f-003-graphql-pagination-can-drive-arbitrarily-large-opensearch-requests), [F-007](#f-007-query-complexity-costs-are-mostly-ineffective), [F-008](#f-008-rate-limit-identity-is-fragile-behind-ingress), [F-009](#f-009-gateway-opensearch-index-config-is-documented-but-ignored), [F-010](#f-010-readiness-does-not-check-critical-dependency-health), [F-013](#f-013-health-returns-http-200-for-degraded-dependency-state), [F-014](#f-014-turbo-cache-inputs-reference-package-lockjson-in-a-pnpm-repo), [F-015](#f-015-cursor-hardening-is-functional-but-loose).
- Uncertainties: tests/builds were not run; actual runtime proxy/IP behavior under Caddy was not validated; production deployment manifests beyond local Compose were not inspected; `.env` secrets were not opened.
- Out of scope / not inspected: generated env/secrets, full runtime/production deployment behavior.
- Inherited or unverified context: cartography service map and docs claims.
- Coverage confidence: high for static config/control findings; medium for runtime deployment impact.

## Decision queue

Findings above are candidates for discussion. They are not approved issues, ADRs, or implementation work.

| Ref | Severity | Confidence | Evidence strength | Impact | Suggested next decisions |
| --- | --- | --- | --- | --- | --- |
| [F-001](#f-001-upload-event-processing-is-not-idempotent-or-order-independent) | High | High | Source evidence; churn | Duplicate/replayed upload events can create duplicates or clobber read-model enrichment | Accept; create issue; document event semantics; plan/implement idempotent handlers/tests |
| [F-002](#f-002-media-acknowledges-out-of-order-variant-events-and-loses-them) | High | High | Source evidence | Out-of-order variant events can be permanently lost | Accept; create issue; implement retry/pending/upsert strategy; add tests |
| [F-003](#f-003-graphql-pagination-can-drive-arbitrarily-large-opensearch-requests) | High | High | Source evidence | Large GraphQL requests can pressure OpenSearch/API resources | Accept; create issue; cap/validate pagination; add security tests |
| [F-004](#f-004-post-auth-redirects-accept-arbitrary-destinations) | High | Medium | Source evidence; churn | Auth-adjacent open redirect/phishing risk | Accept; repro if desired; sanitize relative redirects; add tests |
| [F-005](#f-005-gateway-enrichment-events-can-race-or-be-clobbered-around-base-document-creation) | Medium | High | Source evidence | Gateway search/detail can lose variants/colors | Merge with F-001 or track separately; implement merge-preserving projection updates |
| [F-006](#f-006-stuck-upload-recovery-can-create-unpublishable-stored-records) | Medium | High | Source evidence | Recovery can produce stuck/unpublishable records | Accept; create issue; persist/re-extract metadata; add tests |
| [F-007](#f-007-query-complexity-costs-are-mostly-ineffective) | Medium | High | Source evidence; existing tests/comments | Complexity limits underprice expensive GraphQL fields | Accept; create issue; fix cost lookup; add rejecting tests |
| [F-008](#f-008-rate-limit-identity-is-fragile-behind-ingress) | Medium | Medium | Source evidence; heuristic pattern | Quotas can collapse behind proxy or be bypassed by User-Agent rotation | Decide identity model; configure proxy trust; revise rate-limit key |
| [F-009](#f-009-gateway-opensearch-index-config-is-documented-but-ignored) | Medium | High | Source evidence; documentation mismatch | Environment/test index isolation can silently fail | Accept; wire config; add test |
| [F-010](#f-010-readiness-does-not-check-critical-dependency-health) | Medium | High | Source evidence | Orchestration may route to dependency-broken instances | Decide readiness contract; include checks or document shallow semantics |
| [F-011](#f-011-web-route-and-hook-coverage-misses-critical-failure-paths) | Medium | High | Tool output; source evidence; existing logs | Critical frontend failures can regress unnoticed | Accept; create targeted test coverage tasks; run full coverage in follow-up |
| [F-012](#f-012-upload-client-still-submits-a-demo-userid-contract) | Medium | Medium | Source evidence | Misleading identity boundary could become attribution/security bug | Accept; remove client userId or define contract; update tests |
| [F-013](#f-013-health-returns-http-200-for-degraded-dependency-state) | Low | High | Source evidence | Status-code-only monitors miss degraded dependencies | Document endpoint semantics or split live/health behavior |
| [F-014](#f-014-turbo-cache-inputs-reference-package-lockjson-in-a-pnpm-repo) | Low | High | Source evidence; tool output | Dependency lockfile changes may not invalidate cached tasks | Replace with `pnpm-lock.yaml`; add global dependency input |
| [F-015](#f-015-cursor-hardening-is-functional-but-loose) | Low | Medium | Source evidence | Cursor boundary can be hardened against malformed/weird states | Use timing-safe compare; validate cursor tuple/version/sort mode |
| [O-001](#o-001-orphaned-minio-reconciliation-is-explicitly-non-paginated) | Observation | High | Source evidence | Cleanup may miss later object pages at scale | Accept as context; create issue if bucket scale warrants; add pagination/test |

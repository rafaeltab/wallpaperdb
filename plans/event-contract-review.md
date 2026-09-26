# Event contract review

The initial review covers the current codebase at `46dea0b0`, with particular attention to cross-application events. The user's whole-codebase scope replaces the code-review skill's usual branch diff scope. Follow-up reviews compare `git diff 46dea0b0...HEAD` and read the relevant surrounding code.

Independent reviewers examine standards and specified behavior separately. Authoritative standards come from `CODING_STANDARDS.md`; public contracts, context documents, and ADRs supply the behavioral specification. Fixes use small commits, failing regressions at the owning public boundary, and focused validation before each commit.

## Standards

The first pass confirmed six groups of event violations.

1. Gateway ignored binary CloudEvents headers and lost original headers in quarantine. It now validates both representations and retains the complete original envelope for replay.
2. Color Extractor and Variant Generator ignored binary envelopes and lost their identity in quarantine. They now validate metadata and preserve it through real-broker replay tests.
3. Media accepted conflicting binary and structured metadata. It now rejects inconsistent source, ID, type, and occurrence time.
4. Current event payloads exposed storage coordinates. Public contracts now support logical references, backed by immutable private storage descriptors. Producer and consumer migration preserves retained coordinate-based history. [ADR 0006](../docs/adr/0006-resolve-immutable-assets-through-storage-descriptors.md) records the storage and lifecycle guarantees.
5. Color Extractor could not quarantine a message at the broker payload limit and accepted unsafe retention settings. Quarantine now checks limits and stores oversized failures as recoverable chunks before acknowledging the original.
6. The unused shared publisher and consumer base classes bypassed application-owned delivery guarantees. They were removed with their obsolete examples; the events package exports contracts.

The broader pass also found wallpaper pagination accepting Profile or incompatible color cursors, unbounded color preference arrays, and overflow in weighted color vectors. Capability regressions cover the corrected validation and bounded, stable normalization.

Follow-up reviews found that mixed structured and binary envelopes could disagree about optional correlation and causation fields. All consuming applications now reject those contradictions, including a field present in only one representation.

The new descriptor bucket is a required dependency wherever logical assets are enabled. Health probes now detect a missing bucket and recover when it returns. Real storage and public HTTP tests cover this behavior, including User's optional storage configuration.

A second health review reproduced requests continuing after a sibling probe failed. Independently scoped Effects now cancel those requests before returning an unhealthy result. Tests observe real hanging HTTP connections closing before runtime disposal. This follows the underlying-resource lifetime rule in [composition and operations](../docs/coding-standards/composition-and-operations.md#configuration-and-lifecycle).

Test routing also needed correction. Deployed E2E results were cached despite changes in the running application, and test-file changes did not invalidate typecheck results. E2E tasks now always execute; typecheck inputs include test files. Make routing regressions verify both rules through Turbo's actual task plan.

## Spec

The independent contract pass confirmed the CloudEvents identity loss above. It also found that a fully transparent accepted image produced a zero color vector which Gateway permanently rejected. Color extraction now treats that image as an intentional no-op and does not announce an unusable histogram.

Browser validation found the Web development image omitted workspace dependency builds. The sign-in page failed with a `profile-markdown` import error. The image now builds those dependencies, and agent-browser confirms the sign-in form renders.

Browser validation also found nested interactive controls in expanded wallpaper cards and an unlabelled wallpaper details dialog. Card actions are now siblings of the card button and have accessible names. The dialog has a title and description. Failing DOM regressions reproduced both defects before their fixes.

The upload notification manager also sat outside the router provider. Clicking a notification after leaving the upload page threw instead of navigating back. A production-App regression reproduced the failure. The manager now lives in the persistent root layout under the router and retains the upload queue across navigation.

The final live checks found two further defects. A generated variant advertised its preset bounds of 854 by 480 while its aspect-preserving image was 853 by 480. New variants now publish their encoded dimensions while retaining preset-based storage and occurrence identity. Actual dimensions are part of first-writer object metadata. Historical objects retain their nominal public facts, and malformed metadata fails instead of silently changing an occurrence. Real storage, broker, cancellation and replay tests cover the change.

Profile bootstrap also notified subscribed picture components while rendering an empty pending query. Empty queries now preserve the subscriber's existing empty snapshot. The regression reproduces and removes that React warning without delaying owner changes or cache removal.

## Validation record

Focused red and green logs and browser artifacts are local under `.scratch/event-contract-review/`. Reviewers keep notes there for cursor behavior, producer publication, and consumer delivery. Those generated artifacts are not application source.

The local stack runs through `make infra-start` and `make dev` at `http://localhost:8300`. PostgreSQL's public initialization SQL initially had restrictive host permissions. After restoring readable permissions, the default `make infra-start` succeeded without an override or a database reset. The local Color quarantine stream was updated to the new retention settings without removing messages.

The first browser E2E attempt reproduced the missing Web dependency. Subsequent attempts during live edits encountered service reloads. The completed source passes the browser E2E sign-in and upload checks. These deployed tests now execute on every run.

Agent-browser verified these flows against the running stack:

- Original and transparent PNG uploads complete; duplicate uploads reuse the existing wallpaper. The transparent original produces variants without a color histogram.
- Catalogue cards load their images. Keyboard focus reaches the separately named details action. The details dialog has an accessible title and description and supports Escape and I.
- A fresh 1280 by 720 upload produces an advertised 853 by 480 variant whose decoded browser dimensions are exactly 853 by 480. Its logical reference still names the stable 854 by 480 preset target.
- Color filtering returns wallpapers with histograms. Browser GraphQL calls reject Profile cursors in wallpaper searches with `INVALID_CURSOR`, reject 65 color preferences with `BAD_USER_INPUT`, and preserve ordering for normal, minimum and maximum finite relative weights.
- A Profile picture upload renders through Media in settings and on the public Profile. Removal restores the generated avatar; a fresh request to the old picture URL returns 404 with `Cache-Control: no-store`.
- Clicking an upload notification from Browse returns to Upload and preserves the queue. The final browser console has no router-context, nested-button, dialog-title or Profile render-update errors.

Local evidence includes `profile-picture-flow.webm`, `upload-notification.webm`, `exact-variant-dimensions.webm`, `variant-dimension-green.json`, `browser-contract-results.json`, and `live-contracts-final.json` under `.scratch/event-contract-review/`. The stream inspection confirms that new wallpaper, variant and Profile-picture announcements contain logical references and no storage coordinates or original filenames.

The environment's deprecated Docker builder twice lost an intermediate image during CI. Retrying the individual build succeeded, but the full sequence reproduced the failure. An isolated local Buildx plugin with `DOCKER_BUILDKIT=1` passed Media builds before and after the Tags image E2E and its cleanup. No shared images were pruned and no Docker daemon settings changed. Final CI uses this BuildKit configuration, serial Vitest workers, the loopback Testcontainers host override, and a local Turbo wrapper that forwards those environment variables.

Final `make ci` passed against `14fe7243`: 74 build, lint, typecheck, unit and integration tasks, then 11 E2E and dependency tasks, followed by the coverage merge. The pipeline reported 353 seconds. Its log is `.scratch/event-contract-review/ci-final-buildkit.log`; coverage is `coverage/lcov.info`. The test-utils suite retains its 12 pre-existing skipped tests. No new tests were skipped. The earlier uncached run populated successful task results; the final run reused unchanged results and executed every deployed E2E task.

The successful invocation was:

```sh
DOCKER_CONFIG="$PWD/.scratch/event-contract-review/docker-buildkit/config" \
DOCKER_BUILDKIT=1 TESTCONTAINERS_HOST_OVERRIDE=127.0.0.1 GITHUB_ACTIONS=true \
VITEST_MAX_FORKS=1 VITEST_MIN_FORKS=1 \
VITEST_MAX_THREADS=1 VITEST_MIN_THREADS=1 \
make ci TURBO="$PWD/.scratch/event-contract-review/turbo-loose"
```

All eight application containers are healthy after validation. The task browser is closed; the development stack remains available on port 8300. The generated Media Swagger file was restored after confirming that its differences were formatting only.

## Final independent review

Both reviewers examined `46dea0b0..d43111fa` and the surrounding contracts after the fixes.

Follow-up CI and browser work added isolated User health fixtures in `a94447da` and the notification router fix in `d29c313a`. Both changes have focused regressions and received a final diff review.

The final browser findings were fixed in `f007ed50` and `14fe7243`. Independent Standards and Spec reviews of the dimension change found no new hard issue. Seventeen real storage and broker replay tests preserve both metadata-less and source-tagged historical objects. The Profile tests preserve synchronous sign-out and owner-switch behavior.

### Standards

No confirmed documented-standard violations remain in the reviewed changes. The reviewer checked descriptor ownership, conditional registration, publication ordering, resolution outside database transactions, retained-event compatibility, quarantine acknowledgement, resource cancellation, and public DOM regressions.

The reviewer noted possible duplicated chunk-sizing and repair logic in Color and Variant quarantine modules. This is a heuristic concern, not a documented violation. The current record formats and broker lifetimes belong to different applications. This review keeps that behavior local rather than introducing another shared broker abstraction.

### Spec

No confirmed behavioral findings remain. The reviewer checked ADR 0006, Color and Variant context contracts, User and Media picture availability, and public event schemas. Failed storage operations remain retryable, immutable source identity survives replay, transparent images produce no unusable histogram, retired pictures remain gated, and quarantined messages retain their envelopes.

Final review totals: Standards has zero hard findings and one optional duplication observation; Spec has zero findings. Neither axis has an unresolved confirmed defect.

## Follow-up review

A subsequent assessment at `bec2b1a6` found a validation gap missed by the initial review. Web's `check-types` ran plain `tsc --noEmit` against a solution configuration with an empty file list. It succeeded without checking its referenced application or test files. Explicitly selecting `tsconfig.app.json` exposed production and test diagnostics. The earlier CI result remains a successful pipeline run, but it is not evidence that Web passed typechecking.

The requested follow-up fixes that command and the exposed errors, adds deployed browser regressions for the manually checked cross-service flows, and reduces drift in CloudEvent validation and quarantine mechanics. Reviews of this follow-up compare against `bec2b1a6`.

Deployment and recovery work is tracked in [issue #236](https://github.com/rafaeltab/wallpaperdb/issues/236). Profile editing concurrency and cache ownership are tracked in [issue #237](https://github.com/rafaeltab/wallpaperdb/issues/237).

### Web typechecking

Commits `a749f1d0`, `c39fca6d`, and `a305ace5` fix the production and test diagnostics and change Web's build and check commands to `tsc -b`. The filter now narrows ratio-bearing options before reading their ratio, and the persistent-state hook exposes its existing functional setter behavior in its return type. Test fixtures satisfy their actual discriminated types; no diagnostic suppression was added.

The command regression copies the real Makefile and Web project configuration into an isolated temporary workspace. It proves valid application, test, and Vite fixtures pass, that each invalid fixture produces TS2322, and that restored fixtures pass again. It failed against the old command and passed after the fix. Its private fixtures and build information never alter the live workspace. All 23 Make tests, 114 focused Web tests, the final default typecheck, lint, and production build passed.

### Deployed browser regressions

Commits `fd1c927d`, `650df3e3`, and `da59c4ec` add two deployed journeys and include E2E specs in the workspace's typecheck. The catalogue journey follows a fresh random-pixel upload through its public projection, verifies actual variant dimensions, filters its catalogue entry, opens accessible details with the keyboard, and returns from the upload notification to the intact queue. Existing catalogue entries cannot satisfy the new upload's projection assertions.

The Profile journey creates a disposable Clerk test owner, signs in through the UI, uploads a picture, checks settings and anonymous public delivery, removes it, and verifies the retired URL returns 404 with `Cache-Control: no-store`. Its fixture rejects production keys before requests and deletes only its own returned user ID, including after journey failures. Ten lifecycle regressions cover creation, cleanup, and failure handling; all 24 E2E workspace tests passed.

Both journeys passed against `make infra-start` and the running `make dev` stack. Temporary fault injection made them fail when a 640×360 image was served under an 853×480 URL and when a retired picture remained accessible. After removing the fault hooks, both passed again (three Playwright tests including authentication setup, 18.2 seconds). The committed specs contain no service mocks or request interception. Browser recordings are documented in [the evidence directory](../docs/review-evidence/event-contracts/README.md).

### Shared event and quarantine contracts

Commit `525cdbbd` moves envelope reconciliation into `@wallpaperdb/events/envelope`. Each application retains its payload decoder, accepted source/time policy, domain translation, and delivery behavior. A shared 31-case matrix exercises Gateway, Media, User, Color Extractor, and Variant Generator at their public boundaries. It first exposed eight cases where repeated binary headers silently selected the first value. Shared and existing translation tests then passed: 258 focused tests across six workspaces. All seven affected workspaces passed build, lint, and type checks. `d19edd35` aligns User assertions with the telemetry testing policy.

Commits `c9297271` and `484ff026` put pure quarantine planning, identity, receipt matching, and replay decoding in `@wallpaperdb/core/quarantine`. Applications still own resources, stream retention, retries, repair publication IDs, interruption, and acknowledgement. Real broker regressions first demonstrated lost repeated headers and accepted legacy receipts missing replay metadata. Receipts now require matching bytes and complete CloudEvent values; incomplete legacy receipts use the existing repair path before the input is acknowledged.

Header-heavy inputs revealed a further capacity failure: an original broker-accepted message could no longer fit after quarantine metadata was added. The planner now respects both the complete message budget and JetStream's 64 KiB header limit. Its versioned `original-message-v1` frame archives all original header arrays and bytes inside bounded chunks; ordinary record formats and IDs remain unchanged. Replay validates bounded manifests, counts, lengths, SHA-256, header arrays, and canonical base64. It restores CloudEvent and trace headers without reusing stale broker publication controls. The final focused suites passed 88 tests: Core 25, Color 16, Variant 23, and Media 24, plus all four workspace checks.

### Follow-up independent review

Both axes reviewed `bec2b1a6..484ff026` after the fixes.

- **Standards:** no hard violations or material optional smells remained. The shared modules have explicit interfaces and leave delivery policy with the applications. The public replay decoder also removes duplicated reconstruction from the app tests. Web's command checks the referenced projects; browser tests isolate mutable data and wait for observable outcomes.
- **Spec:** no confirmed missing, incorrect, or out-of-scope behavior remained. The reviewer checked the real typecheck command, retained event formats, application-specific decoding, quarantine identities and capacity, durable replay, and the requested browser journeys. Deployment/recovery and Profile concurrency remain the separately requested issues.

These are review conclusions about the inspected changes, not proof that the entire codebase has no defects.

### Follow-up full validation

`make ci` passed against source commit `484ff026` and the rendered documentation updates recorded in `9f950b9b`. It completed 74 build, lint, typecheck, unit, and integration tasks, then 11 E2E/dependency tasks and the coverage merge. The pipeline reported 650 seconds. Twenty-one unchanged main tasks and three E2E build dependencies used cached results; every E2E test task executed. All five deployed Web tests passed in 22.7 seconds, including both new journeys. The test-utils suite retains its 12 existing skips; no new tests were skipped.

The invocation used the isolated BuildKit configuration, loopback Testcontainers host override, serial workers, and Turbo environment wrapper shown earlier in this report. Its log is `.scratch/event-contract-review/ci-followup-final.log`; merged coverage is `coverage/lcov.info`. These host-specific setup requirements remain within issue #236's scope.

`make infra-start` succeeded with the existing `make dev` process running. All eight application containers were healthy after CI. The generated Media Swagger file was restored only after verifying semantic equality with the committed JSON.

Agent-browser verified upload/duplicate counts, notification navigation back to the preserved queue, color/PNG filtering, keyboard details, and decoded 853×480 variant pixels. After CI, the Profile check uploaded and decoded a 1280×720 picture, confirmed anonymous Media delivery returned 200, removed it through the UI, and confirmed the retired URL returned 404 with `Cache-Control: no-store`. The original generated avatar was restored, and no browser page errors were recorded. The recordings show the UI; the decoded dimensions and HTTP assertions were checked separately through the browser.

The task browser session is closed. The development stack remains running on port 8300.

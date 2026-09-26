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

## Spec

The independent contract pass confirmed the CloudEvents identity loss above. It also found that a fully transparent accepted image produced a zero color vector which Gateway permanently rejected. Color extraction now treats that image as an intentional no-op and does not announce an unusable histogram.

Browser validation found the Web development image omitted workspace dependency builds. The sign-in page failed with a `profile-markdown` import error. The image now builds those dependencies, and agent-browser confirms the sign-in form renders.

## Validation record

Focused red and green logs and browser artifacts are local under `.scratch/event-contract-review/`. Reviewers keep notes there for cursor behavior, producer publication, and consumer delivery. Those generated artifacts are not application source.

The local stack runs through `make infra-start` and `make dev` at `http://localhost:8300`. PostgreSQL's initialization directory has restrictive host permissions in this environment; a temporary Compose override mounts a readable copy of the public SQL without changing database contents. The local Color quarantine stream was updated to the new retention settings without removing messages.

The first browser E2E attempt reproduced the missing Web dependency. Subsequent attempts during live edits encountered service reloads. Final verification must run against the completed source and include repository CI, uncached browser E2E, and specific upload, discovery, and Profile-picture flows in agent-browser.

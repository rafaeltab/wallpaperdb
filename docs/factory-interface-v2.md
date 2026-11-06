# Factory public interface v2

Status: live producer with isolated fake transports for client development. [The public HTTP entry](../apps/factory/src/http/index.ts) exports the [v2 contract](../apps/factory/src/http/v2/contract.ts), `operationsServer`, `liveV2Data` and `fakeV2Server`. [Factory composition](../apps/factory/src/composition/implementation.ts) serves v1 and live v2 on the same maintainer-only origin. UI migration and activation of a new deployed release are separate work.

The target is the selected [canvas prototype at ecd35afb5](https://github.com/rafaeltab/wallpaperdb/blob/ecd35afb51aab61bb9132690d26330c36165ec99/apps/factory/frontend/src/factory-canvas-prototype.tsx), preserved in [PR #677](https://github.com/rafaeltab/wallpaperdb/pull/677). The audited factory baseline is merged `main` at [7e6f0dcab](https://github.com/rafaeltab/wallpaperdb/tree/7e6f0dcab791b28ab6cb6d59d0a087c8861605ac).

## Live producer

[The producer lifetime](../apps/factory/src/composition/v2.ts) publishes a local normalized board from existing factory observations, journals, T3 metadata and planning attempts. [GitHub collection](../apps/factory/src/adapters/github/observations.ts) adds an open-issue search index, PR titles/draft state, labels and project choices, comparison-bound checks/reviewers, required-check flags and verified ancestry. Issue-context queries collect scalar PR associations; rich PR metadata is collected once per PR per refresh to avoid multiplying GraphQL cost through timelines. Candidate eligibility uses the existing factory inspection policy. Snapshot, detail, search and update handlers never collect provider data or advance execution.

The live producer supports conditional snapshots, bounded changes polling, long polling and SSE through [the shared transport](../apps/factory/src/http/v2/server.ts). [The board capability](../apps/factory/src/capabilities/board/index.ts) commits complete revisions before notifying readers. Unchanged fact payloads keep their versions when source freshness advances. Missing historical context, unobserved evidence and old cache formats remain explicitly unknown or partial.

[SQLite persistence](../apps/factory/src/adapters/store/board.ts) retains the snapshot, its detail versions and 64 atomic change batches across restart. Compare-and-set publication preserves replay when producers overlap. Command UUIDs bind the full request before effects; an atomic claim prevents another worker from executing the same accepted command. Receipts are retained without automatic expiry, including uncertain responsibility. Identical retries return the retained receipt before checking a stale action token. A process interrupted before recording its outcome leaves an uncertain receipt. Reconcile the owning factory operation before deliberately requesting further work; neither a missing thread nor a missing receipt authorizes another launch.

The [live producer](../apps/factory/src/capabilities/board/implementation.ts) permits 64 outstanding commands per producer. At that limit, new commands receive `503 unavailable` before acceptance. Identical retries still replay their existing receipts and do not add worker queue entries. Completed commands release pending capacity; their durable receipts remain available.

Live configure/start/resume/cancel/preview commands invoke the existing factory operations. They preserve control revisions, stage/run/question selectors and permanent admission consumption. Preview remains advisory. New v2 previews retain their originating board and planning basis. Older v1 attempts without that basis report unknown applicability. Legacy recovery records without structured phases remain unknown until fresh observations provide them.

The existing [startup entry](../apps/factory/src/main.ts) and [SQLite migration workflow](../apps/factory/src/composition/state.ts) apply the generated migrations; use the repository's existing factory installation/activation workflow for a deployed release. No separate public listener, browser credential, database reset or live dispatch is needed to consume v2. Provider refresh cadence and source age remain independent of update-stream connectivity.

## Run the fake transports

From the repository root:

```sh
make run PACKAGE=factory SCRIPT=dev:interface-v2
```

[The standalone entry point](../apps/factory/src/http/v2/demo.ts) listens at `http://127.0.0.1:9402`. Set `FACTORY_V2_DEMO_PORT` to select another port. It does not load the production factory configuration. SIGINT or SIGTERM closes its streams and pending polls. Tests and embedded clients can construct `fakeV2Server` directly and own its `listen`/`close` lifetime.

[The server](../apps/factory/src/http/v2/server.ts) implements conditional snapshots, immediate/long polling, replayable SSE, item details, paginated issue search, plan details, command submission and receipt lookup. `/health` reports `dataMode: "fake"`. Responses have `X-Factory-Data: fake`, and snapshots have `meta.dataMode: "fake"` plus a diagnostic. The sample uses `.invalid` links and contains planned/working issues, draft/open stacked PRs, checks, human review, manual recovery and automatic conflict recovery.

[The simulator](../apps/factory/src/http/v2/fake-state.ts) accepts the advertised configure, start, resume, cancel and preview-plan commands. It updates only the in-memory sample and publishes an atomic change batch. Submit a command using the `actionId` and opaque precondition from the latest board, then observe its receipt and the changes feed. Commands drive updates; reads and heartbeats do not advance the sample. No GitHub/T3 request, worker, database or real factory command is connected.

All sample state, receipts and history disappear on restart. Each startup uses a new cursor generation. Fake acceptance is process-local, so the durable acceptance and 24-hour receipt retention described for the live contract below do not apply to this server. Replaying an identical command is safe only within that process lifetime. The fake ledger retains at most 512 commands, then rejects new commands with `503` until restart. It retains at most 32 sample plans.

The server defaults to 64 retained change batches, returns at most 32 batches per polling page, and permits at most 64 simultaneous SSE/long-poll connections. SSE uses 15-second heartbeat comments and a 64 KiB frame limit. An oversized batch or write backpressure signals `resync-required` and closes the stream. Long polls wait at most 25 seconds. JSON bodies are limited to 128 KiB, with the contract's separate 16000-character context limit. Constructor options can lower replay retention or frame size for recovery tests.

[The HTTP contract tests](../apps/factory/test/v2-http.unit.test.ts) cover validators, version preconditions, commands, receipts, search and replay. [The loopback HTTP tests](../apps/factory/test/v2-http.integration.test.ts) cover actual SSE framing/replay, live updates, long polls and stream cleanup. Run them with:

```sh
make test-focused PACKAGE=factory ARGS='test/v2-http.unit.test.ts test/v2-http.integration.test.ts'
```

## What the UI needs and what exists

The factory already has a useful read model. [The current observation contract](../apps/factory/src/capabilities/observe/contract.ts) contains candidate/context issues, open and related PRs, independently dated GitHub/T3 snapshots, cached jobs, recovery observations and current local controls. [The HTTP contract](../apps/factory/src/http/contract.ts) exposes those through `/api/scheduler`, `/api/observations`, `/api/threads` and `/api/job`. [Planning attempts](../apps/factory/src/capabilities/plan/contract.ts) expose progress and validated proposals. These should supply v2 rather than be replaced by another execution system.

“Collected” below distinguishes information held privately from information a UI can consume without reconstructing factory policy.

| UI feature | Current merged interface | V2 requirement and missing work |
| --- | --- | --- |
| Issue title, number, URL | Available, including context issues | Stable repository-scoped identities; preserve title/URL independently from PR metadata |
| Labels | Names available | Collect label IDs and colors; normalize reusable labels |
| Priority, size, project status | Names or null available | Identify the configured project and option IDs, with explicit priority/size ranks; distinguish unmarked from unavailable project data |
| Nested parent groups | Parent issue numbers available | Typed parent edges, complete context records, provenance and cycle/conflict diagnostics; never interpret membership as a blocker |
| Blocker lines | Explicit blocker numbers available | Directed prerequisite records, source provenance and factory-verified satisfaction for each dependency |
| Planned/Working/In review sections | UI would join project fields, jobs and PR observations | Publish stable work items with authoritative placement and status; retain unknown/unclassified states |
| PR title, draft/open distinction | PR number, URL, state, refs and OIDs available | Collect PR title and `isDraft`; do not borrow an issue title or infer draft from a workflow label |
| PR conflicts | Recovery/progress and manual-recovery facts exist; no general mergeability field | Collect mergeability, including GitHub's pending/unknown result; distinguish a conflicting comparison from an active repair or human escalation |
| Stack base/tip and order | Ref names/OIDs and private durable join/maintenance facts exist | Publish verified PR-base relations and linear display stacks; branch-name equality alone is insufficient |
| CI indicators and tooltips | Aggregate success/failure/pending/unknown at an evidence head | Collect individual check/run identifiers, names, requiredness, links and results; publish actual check groups, not a fixed list of assumed checks |
| Reviewer avatars and state | Aggregate review decision; adapter inspects review commits | Collect reviewer identities, avatars, requests and review dispositions; expose comparison-specific evidence |
| Ready PR vs ready issue | Job delivery readiness and issue eligibility evidence exist in different contracts | Separate readiness for pickup, verified PR readiness and verified landing; expose evaluated reasons |
| Implementing/reviewing/babysitting/repairing/restacking | Stage/activity and recovery observations exist | A public status projection, stable maintenance IDs, progress timestamps and capacity ownership; avoid parsing progress strings |
| T3 links | Environment/thread identity, configured browser origin and evidenced associations available | Publish resolved supported web/native links and association quality; UI should not rebuild URLs or infer ownership from titles |
| Human-attention count/filter | Question, resume, readiness and recovery facts are scattered | An authoritative attention decision per work item, including unknown; count items once across issue/PR/job representations |
| Resume/cancel/play actions | Commands exist; resume includes current stage/run/question selectors | Publish available/disabled/pending/unknown actions and an opaque state precondition; retain validation at execution time |
| Factory pause, concurrency, admission allowance | Available with revision compare-and-set | A small public control view including occupied/consumed totals and action availability; preserve permanent admission consumption |
| Start issue/search | Start exists; planning discovery and observations have a bounded candidate/context set | A local searchable issue index, complete hit metadata, pagination and admission availability, including non-ready issues shown as disabled |
| Plan preview and progress | Submission/observation, deadlines, selection/rejection and thread ownership exist | Include the active/latest attempt in the board and expose a versioned plan detail response; keep advisory edges separate from actual prerequisites |
| Freshness/error banners | Independent GitHub/T3 envelopes and jobs observation time exist | Source records with actual observation and stale times, coverage and retained facts; unknown is not an empty successful result |
| Live and semi-live updates | Frontend polls the complete scheduler snapshot every second | One projection cursor, conditional snapshots, atomic entity changes and an optional replayable server-sent event feed |
| Highlight colors/pulse, ordering, columns, collapse, fit, long names | Pure prototype behavior | Remain in the UI. No endpoints for pixels, colors, animation frames or collapsed groups |

The missing fields come from three kinds of work: extending GitHub collection, exposing existing factory/T3 evidence in a stable form, and producing the versioned projection/change protocol. Merely renaming `/api/scheduler` cannot provide them.

## Read model and ownership

### One coherent board

`GET /api/v2/board` returns `FactoryV2Snapshot`. It is a single committed projection revision containing normalized entities and a factory control view. Its scope is the configured repository and factory, not a request-defined viewport.

The board includes:

- Open ready-for-agent issues, including blocked candidates. Active, parked, uncertain and manual-recovery admissions remain represented even when labels or external lifecycle change.
- Open repository PRs, including independent/unowned PRs. Related closed/merged PRs remain context when needed for active work or verified dependencies.
- Parent and prerequisite context, current jobs and maintenance operations, their evidenced threads, and active/latest planning attempts.

Every reference resolves inside the snapshot, possibly to an issue with unknown metadata. Context issues do not automatically receive cards. A collector limit, inaccessible parent or incomplete index is explicit in `Coverage`; it must not silently become an empty list. A complete prior observation can remain visible after refresh failure, dated by its source. Staleness and coverage are separate facts.

The projection commits a consistent local cut of independently observed sources. It does not claim GitHub and T3 were sampled at the same instant. `committedAt` dates the projection; `Fact.observedAt` and `Source` date its inputs. A transaction or equivalent publication mechanism must prevent half-old/half-new references from becoming a public revision. Publishing snapshots does not authorize execution.

Repository-scoped opaque IDs identify entities across renames and refreshes. Numbers are display/search fields, never global IDs. Prefixes are type distinctions, not instructions to decode the remaining string. An entity version changes whenever its public representation or detail validity changes. Parent copies in two UI sections use client instance keys, not two backend issue identities.

`Fact<T>` distinguishes known data from unknown data. A known `null` means observed absence. An empty known list means a complete observed empty list. Provider failure preserves the last known fact and marks its source failed/stale; it does not remove entities. Unobserved facts remain unknown. No absolute worktree paths, journal paths, credentials, prompts or internal exception stacks belong in this contract.

### Work items and statuses

`WorkItem` is the card identity. A PR card references the PR and its evidenced issue associations; it may have zero, one or multiple issues. It can reference multiple jobs or threads without choosing the first one. `metadataIssueId` identifies the evidenced issue supplying the card's priority, size and issue labels. When that choice is ambiguous or absent, show the PR's own labels and unavailable issue priority/size rather than borrowing the first linked issue. A working job with a published PR is projected onto that PR card; a separate issue card is not also created for the same execution. An issue can still have several distinct PR cards.

Place undispatched candidates in Planned, admitted work without a displayed PR in Working, and open PR cards in In review, including babysitting and manual recovery. If evidence cannot establish a placement, return `unclassified` with a diagnostic. A parked or uncertain admission must not disappear because its worker cannot be observed. Terminal cancelled/landed records can remain context without creating ordinary open cards; retained manual recovery can keep affected closed work visible.

Status and attention are factory decisions. Raw GitHub draft, project status, CI results and PR lifecycle remain available separately. An unfamiliar provider status maps to public `unknown`, retaining a meaningful label. The client must not derive Implementing from “thread running,” Ready from green GitHub checks, or Restacking from a title.

`Job.stage` and `Maintenance.phase` provide structured progress. Their timestamps support elapsed time and pulse rendering without generating a revision every second. A public job identity is stable for its admission even before an internal intent/thread binding is available; such a retained reservation has unknown execution and a null start time rather than a fabricated elapsed timer. Capacity ownership is explicit: jobs, uncertain reservations and recovery can consume slots; parked work can release a slot while its distinct admission remains consumed. The factory control totals are authoritative. No command resets admission consumption.

### Relationships, stacks and evidence

The contract uses named endpoints rather than ambiguous `source` and `target`:

- `prerequisiteIssueId` is the blocker; `dependantIssueId` needs it. The chosen UI draws its arrow toward the prerequisite.
- Parent edges describe grouping/context. The UI may traverse them for its configured highlight mode, but they do not grant execution prerequisites.
- Issue/PR association records distinguish factory binding, explicit closing references and incidental cross references. Cross references are context, not ownership.
- PR-base edges describe verified stack structure. Plan `dependsOn`/`conflicts` belong only to the advisory proposal.

The [accepted stack policy](../apps/factory/docs/adr/0003-linearize-verified-unmerged-prerequisites.md) allows verified unmerged prerequisites and requires current-tree verification after replay. V2 exposes that evaluated satisfaction and comparison. PR closure, mergeability or an old green head cannot establish it.

Display stacks are maximal unambiguous linear sequences, ordered base to tip. Stop a sequence at a fork; retain the cross-stack PR-base edge. A PR occurs in at most one display stack. Single independent PRs need no stack record. Cycles, ambiguous ownership or missing ancestry produce diagnostics and independent cards rather than an invented order. Factory journals or verified Git ancestry establish edges; matching ref names only identifies a candidate to verify. Each evidenced edge/stack retains its source stamp so updates can invalidate stale topology.

Checks and reviews name the comparison they describe. Provider evidence can identify a head without establishing the tested/reviewed base; `EvidenceComparison` keeps that base null. The UI can show head-only results with an explicit qualifier. If an evidenced head/base differs from current metadata, show previous-comparison evidence or unknown, never current-comparison success. GitHub metadata naming the current base does not prove CI tested it. Factory `Readiness` requires a full verified comparison, remains distinct from provider observations and follows accepted review/replay policy. A head can be CI-green while factory readiness remains unknown or blocked. Missing check requiredness is also unknown, not optional.

### Human attention

`Attention.required` means a maintainer must act before the factory can make progress on that item. Reasons are structured and can point to available actions.

| Situation | Attention |
| --- | --- |
| Current PR needs human review, with no automatic factory review resolving it | Required |
| Parked job awaiting an answer in its owning T3 thread | Required; link to T3, offer resume only when its own conditions permit |
| Explicit manual recovery or an uncertain operation requiring operator reconciliation | Required |
| Conflict with an automatic recovery path still running or queued | None |
| Conflict escalated to manual recovery | Required |
| Implementing, reviewing code, publishing, babysitting, repairing CI, waiting for CI or a normal prerequisite | None while progress is automatic |
| Ready, landed or deliberately cancelled work | None, unless a separate retained manual-recovery obligation remains |
| Insufficient evidence about who can advance the work | Unknown, with reasons |

The UI derives the count by filtering distinct `WorkItem.id` values with required attention, not by counting jobs, parent headers or reasons. Two cards for genuinely different PRs can count separately; an issue and its displayed PR must not count the same execution twice. Also expose unknown attention through a separate UI qualifier. With partial coverage the count is a lower bound; with stale sources it is a dated count. Never label missing evidence “0 need attention.” Clicking the count changes client highlighting only and highlights no connection edges.

### UI calculations

The UI owns layout, approximation of priority/size order, two-column packing, status colors, synchronized pulses, collapsed groups, selection copies, relationship traversal, fit and long-name preferences. Stack status summaries and draft/open counts derive from the same work items and PR metadata as their rows. Unmarked priority/size is a known null; unavailable rank must not be silently treated as lowest priority. A logical selection is separate from a visible parent/group copy.

## HTTP surface

The live paths are relative to the existing maintainer-only factory origin. The standalone fake serves the same paths on its loopback origin. This version does not introduce public Internet access or a separate identity provider. Preserve the current origin checks and independently enforce command policy; an action descriptor is not authorization. Source credentials stay on the factory host.

| Method and path | Request | Response |
| --- | --- | --- |
| `GET /api/v2/board` | Optional `If-None-Match` | `200 FactoryV2Snapshot`, or `304` with no body |
| `GET /api/v2/board/changes` | Required opaque `after`; optional `waitMs` from 0 to 25000 | `200 FactoryV2Changes`; malformed cursor uses `400`; expired/reset/different-scope cursor uses `409` and `resync-required` |
| `GET /api/v2/board/events` | Initial `after`; reconnect `Last-Event-ID` | `text/event-stream` carrying `FactoryV2Event`; optional capability |
| `GET /api/v2/items/{itemId}` | Required `If-Match` entity version | `200 FactoryV2ItemDetails`; `412` if detail no longer matches the card; `404` if absent |
| `GET /api/v2/issues/search` | `q` up to 200 characters, `limit` from 1 to 50, optional `pageToken` | `200 FactoryV2IssueSearch` |
| `GET /api/v2/plans/{planId}` | Plan identity | `200 FactoryV2PlanDetails`, or `404` for an absent/expired attempt |
| `POST /api/v2/commands` | `FactoryV2Command` | `202 FactoryV2CommandReceipt` after durable acceptance; replay may return the retained terminal receipt with `200` |
| `GET /api/v2/commands/{commandId}` | Client command UUID | `200 FactoryV2CommandReceipt`, or `404` when no retained receipt exists |

Opaque IDs and query tokens are URL-encoded. JSON is required for commands. Unknown keys or invalid limits are rejected. Start context remains bounded to 16000 characters; preview accepts no planning overrides. A configured finite concurrency/allowance is a positive safe integer; `unlimited` replaces the v1 `-1` transport sentinel. Lowering an allowance below consumption prevents further admission rather than restoring prior admissions. Commands do not accept arbitrary branches, operator pins or prerequisite evidence from the UI.

Read handlers inspect locally published state only. They never query GitHub/T3, run a scheduler tick, reconcile a stage, launch a worker or perform a restack. Search reads a locally refreshed index, so typing does not invoke remote discovery. Its result describes current candidate eligibility and start availability, including disabled non-ready issues. Pagination tokens bind the query and index generation; expired tokens require restarting the search. Search results do not mutate the board cache.

Detail responses keep long question text and individual check histories outside the initial board. `If-Match` binds them to the selected item version. Stale detail must be discarded/refetched, not merged into a newer card. The plan response includes normalized referenced issues and threads so old proposal references remain readable without decoding IDs. Only active/latest plans belong in the compact board; older retained plans use the detail route.

Use `FactoryV2Problem` with `application/problem+json` for invalid requests, unsupported capabilities, stale actions, unavailable storage or rejected commands. Statuses are `400`, `403`, `404`, `409`, `412`, `415`, `422` or `503` as appropriate. A command-response `412` uses `stale-action`; clients refresh before attempting a newly authorized action. A well-formed cursor that cannot be resumed uses the typed resync response, not a generic retryable command error. Initial lack of provider data is a successful snapshot containing unknown facts; inability to read the local projection is `503`.

## Snapshot and update protocol

The snapshot ETag identifies its scope and cursor, with standard [conditional GET semantics](https://www.rfc-editor.org/rfc/rfc9110.html#name-if-none-match). Requests have a normal HTTP Date header for clock estimation. Reading a snapshot does not change `committedAt` or its ETag merely because elapsed time increased. Provider refresh/progress changes and corrected facts do create revisions; animation frames do not.

Start with a full snapshot. Every later delta names `fromCursor` and `toCursor`. Apply all changes and optional replacement metadata atomically, then publish the new cursor to React. Upserts replace whole entities, so omitted fields in a replacement do not leave ghost facts. Removals are explicit. No referential integrity is required in the middle of applying a batch, but it must hold after the batch. A batch must not upsert and remove the same table/ID pair.

The client only applies a batch whose `fromCursor` equals its current cursor and scope. A duplicate already applied `toCursor` can be ignored; any other mismatch requires a fresh snapshot. Cursors are opaque equality tokens, not timestamps or JavaScript numbers. They bind the repository/factory scope and projection generation. Normal process restart should retain a cursor when its projection and replay history survive. Losing/rebuilding that history changes the generation and requires resync. Reuse unchanged entity versions and fact payloads; repeated confirmation can update shared source freshness without rewriting every card's elapsed time.

`changes` is the semi-live baseline. An unchanged response retains the requested cursor. Changed responses contain a contiguous sequence, ending at `nextCursor`; if `hasMore`, fetch again immediately before waiting. Responses are bounded, but a single atomic batch is never split across responses. If a batch cannot fit, require a new snapshot. Expired, different-scope or reset cursors require a snapshot. `BoardMeta.transport` advertises changes/events support and a polling recommendation. When changes are unavailable, conditional full-snapshot polling remains valid.

The optional live transport uses the same batches through [server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html). Each `change` frame has `id: toCursor`; `data` contains the delta. Use the query cursor only on initial connect; a nonempty `Last-Event-ID` takes precedence during reconnection. Replay then attach live consumption without a gap. Heartbeat comments keep intermediaries active and do not advance the cursor. If replay expires or a slow consumer exceeds a bounded queue, send `resync-required` and close; the client closes its EventSource, fetches a snapshot and opens a new stream. Pre-stream resync errors are not inspectable through native EventSource, so the client also uses the changes endpoint after an unexplained reconnect failure. Do not rely on exactly-once transport delivery.

Both transports must retain last-known cards through disconnects, show connection/source freshness separately and resume after the last applied cursor. Abort obsolete requests on navigation, scope change or a newer snapshot; a late response cannot replace a newer cursor. Pause background polling when hidden and reconnect on visibility restoration. Maintain one board cache regardless of whether polling or SSE delivered a batch. Debounce graph recomputation for complete batches, preserving selections and collapsed IDs that still exist.

Pushing a local revision does not make a two-minute-old GitHub observation live. The current [collector cadence](../apps/factory/src/capabilities/observe/contract.ts) is 120 seconds with a 240-second stale threshold; [composition](../apps/factory/src/composition/implementation.ts) separately runs scheduler observation. V2 exposes actual timestamps and planned refresh times. A later producer can use targeted active-PR refreshes, invalidation after commands and provider webhooks to reduce latency, while a slower full refresh repairs missed events. Those are producer choices, not guarantees already provided by this contract. Measure provider call budgets before setting a tighter freshness target.

## Commands and uncertainty

Available actions carry an opaque precondition tied to the current target, control revision, expected stage/run/question and relevant comparison as applicable. The client copies it without reconstructing internal selectors. `validUntil` can disable a locally expired action before another projection revision arrives. Disabled, pending and unknown actions carry reasons, not a misleading enabled boolean.

The command kind must match the referenced action. The factory revalidates scope, permissions, current state, capacity and comparison before executing. A stale precondition returns a conflict; the UI refreshes and requires a new explicit action. No broad `resume` is inferred from a failed CI icon. Answering a question still happens in the supported T3 thread; resume continues the existing job and stage. Restack status toggles, theme, relationship depth, title behavior and T3 target preference are not factory commands.

The client generates one UUID before submission and retains the exact body if the response is lost. The producer must durably bind command ID to the full request before external effects. Identical replay observes the same receipt; reusing an ID with a different request returns `id-reused`. Check a retained duplicate before rejecting its now-stale precondition. This prevents an accepted action from becoming a second launch on network retry. It does not claim universal exactly-once external execution.

`accepted` means the command has durable responsibility, not that the job is ready or even that execution has started. `succeeded` means the requested operation completed, not that an implementation job or advisory plan has finished. A preview receipt points to its plan attempt. `PlanAttempt.basis` records the observed board cursor and separately versioned planning inputs/controls; applicability compares relevant inputs, not equality with the whole current board cursor. The attempt's own progress and unrelated presentation changes do not make its proposal stale. `resultingCursor` is set only when a corresponding board revision is available; a command receipt must not be treated as a board snapshot. Observe the receipt while pending; board changes still enter the single board cache through the snapshot/change protocol.

An uncertain external outcome remains `uncertain` with reconciliation instructions. Never submit a fresh UUID just because a request timed out or a thread was not found. Completed receipts are retained for at least 24 hours; unresolved/uncertain responsibility is retained until reconciliation. A missing/expired receipt after uncertainty is not evidence that execution never happened. No new external retry is authorized by a `404`.

## Migration and implementation acceptance

Keep v1 paths and existing clients working. Add v2 as a read projection over current journals, observations and planning attempts, translating private records at the HTTP seam. Do not make the UI import capability internals or replace execution policy with the presentation model. Public v2 response types are independent of Effect, Fastify, React and storage schemas. Unknown native states have explicit public fallbacks; additions to closed public unions or removals require a new major contract version.

Both producers advertise polling and SSE. Missing evidence produces unknown/partial facts. The following scenarios define the public behavior required by the UI:

- The same projection supplies all labels, rankings, parent copies, PR/draft markers, reviewer avatars, CI tooltips, stack summaries, links and action decisions without provider requests per card.
- Native/fallback parent and prerequisite edges remain distinct. A verified unmerged prerequisite is satisfied; an older passing head, ambiguous stack or missing PR remains unknown/blocked. A fork does not duplicate PR cards in two display stacks.
- An issue with several PRs and an external PR with no factory job render correctly. A parked job, active recovery and uncertain reservation have correct slot/admission totals. A missing T3 binding does not imply a second launch is safe.
- Human review, an unanswered question and manual recovery count once per actionable card. Automatically recoverable conflicts do not count. Missing attention evidence remains visible as unknown.
- Refresh failure retains dated metadata, never deletes a stack or turns missing checks green. Completeness limits and missing parent records are visible. Checks/reviews at an old comparison cannot approve the new comparison.
- Collapse/expand and highlights operate on stable IDs. A comparison/status update does not reset the whole canvas, change selection copies or interrupt UI-owned animation state.
- Snapshot plus replay has no race, duplicate application is harmless, missing/out-of-order batches trigger resync, removals clear obsolete data, and generation reset/slow-consumer recovery works with both live and polling clients.
- Conflicting commands, expired action tokens and duplicate command IDs cannot start or resume work twice. An uncertain response remains observable without creating another admission. A GET cannot advance execution.
- Benchmark initial compressed snapshot size, single-PR delta size, publication-to-client delay, provider refresh lag and graph recomputation separately for 100/300-item boards. No unmeasured latency claim is part of this proposal.

The fake transports exercise simulated state changes. [Live HTTP tests](../apps/factory/test/v2-live.integration.test.ts), [composition tests](../apps/factory/test/composition.integration.test.ts) and [GitHub adapter tests](../apps/factory/test/observations-github.integration.test.ts) cover the live producer, durable command handling and provider translation. Existing factory policy and T3 adapter suites retain their owning verification responsibilities.

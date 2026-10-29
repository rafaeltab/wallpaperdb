Implement only frozen issue {{ISSUE}} for Boat cohort {{COHORT}}.

Your authoritative application base is dc17dead07c1d1f66e1806412cb7623812601bf1.
Read this checkout's AGENTS.md, repository skills, and your exact issue entry in
scripts/boat-cohorts.json. The coordinator supplies the frozen regression evidence.
Live tracker reads are for claim/status/dependency verification; if the task scope
has changed, report it to the coordinator before proceeding. Do not silently alter
the frozen brief. Preserve the infrastructure overlay in your checkout.

First wait for the coordinator's enrollment gate. Run `make boat-await` before
implementation, tests, or stack startup. The coordinator enrolls and prepares this
worktree. You must not provision, select, resize, resume, stop, or delete remote
environments, change enrollment or cache settings, or install Boat credentials.

Use ordinary Make commands. Git, source edits, and your T3 session stay local.
Compute is remote for validation. Cohort A's development stacks are local; cohort
B's development stacks are remote. Retain local dependencies for source tooling.
Do not work around remote failures with heavy local validation. Return logs and
the failure to the coordinator. Do not add workload locks or serialize VM work.

Claim only your selected product issue, verify assignment and project status,
and follow its accepted scope. Reproduce before repair. Do not claim sibling
issues. Do not close the prototype, its map, or make an operating-model decision.

For this issue, complete CONTRIBUTING.md#live-application-verification. After the
enrollment gate opens, start this worktree's development application with ordinary
Make commands. In A it must run locally; in B it must run on this worktree's Boat
worker through the existing routing. Use the development stack and source watcher,
not only the temporary stack created by make test-e2e. The coordinator manages the
remote environment; you start and exercise the application through Make.

Verify application health and authenticate where needed. Exercise the changed code
through the running UI, API, or worker with real dependencies and concrete inputs.
Retain the tested revision, startup/health timestamps, scenario actions, expected
and observed results, and relevant logs. Also measure one source edit reaching the
running application and preview without a full reload where HMR applies. Restore
any temporary probe and confirm its removal. Notify the coordinator when the stack
is ready so host-resource and overlapping-stack measurements can be collected.

Attach a recording to the draft PR whenever it can demonstrate the changed
behavior, following the repository's pr-video-attachment skill. A nonvisual change
still requires live exercise and concrete evidence; explain why a recording has
no useful demonstration when inapplicable. Keep secrets and private auth artifacts
out of recordings. Missing startup, scenario, or applicable video leaves the issue
incomplete. Report a blocker promptly and preserve the draft as incomplete rather
than substituting passing tests or a statement that no preview was exercised.
Stop your owned application processes when the coordinator finishes measurement;
leave worker lifecycle and teardown to the coordinator.

This is an independent implementation. Do not inspect the other cohort's
checkouts, branches, commits, patches, implementation artifacts, PRs, comments
containing solutions, or conversations. Do not search broadly through the host's
worktree directories. If GitHub shows a draft from the other cohort, do not read
its body, code or review. Its existence does not complete your assigned task.
If you accidentally access another implementation, stop and report the access.
The coordinator will audit available T3 activity/tool histories afterward.

Publish a draft PR targeting the prototype experiment base supplied by the
coordinator, with no closing keyword. Link it to your T3 thread. Never merge,
mark ready, enable auto-merge, choose another cohort's fix, or close the product
issue. Keep its project status In Progress for the draft. Return the draft URL,
head SHA, exact tested commands/status, task hashes/cache evidence, retained logs,
failure/recovery observations, and any pending checks. Do not poll PR checks.

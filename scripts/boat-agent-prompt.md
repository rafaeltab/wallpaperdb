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

Launch Boat cohort A under issue #557, using scripts/boat-cohorts.json and
scripts/boat-agent-prompt.md from the inspected prototype branch.

First verify every qualificationRequired gate has actual recorded evidence. A
configuration or fixture test does not qualify the Boat path. If any gate is
missing, complete the single-worker verification and stop its worker first.
Recheck the five issues read-only for closure, blockers, and work elsewhere.
Replace resolved or concurrently claimed inputs before freezing both cohorts.
Do not modify or claim product issues until their measured agents begin.

Freeze the application base, full briefs/comments, regression inputs and hashes,
infrastructure overlay SHA, and a shared baseline artifact inventory. Save a
frozen.json marker in the experiment cache directory to disable upstream reads.
Copy no new cohort A artifact into the baseline or cohort B directory. Ensure
cohort B has no running measured agents or stacks. Record existing unrelated host
activity separately rather than stopping it.

Use T3 delegate_task for five fresh child contexts, isolation=worktree,
role=implementation, mode=async, distinct stable clientRequestId values. Set
target exactly to providerInstanceId=codex, model=gpt-6.1-sol,
options={reasoningEffort:high,serviceTier:default}. Discover the live descriptors
first; verify each returned provider, model and options. Do not use top-level
threads as a substitute for children. Retain each taskId and childThreadId.

Each task receives only its frozen brief/evidence plus the rendered agent prompt,
and begins at make boat-await. Read its T3 worktree binding, then perform its
technical enrollment yourself with MODE=validation SIZE=large COHORT=a. Install
the pinned prototype CLI in that worktree, prepare the shared cache settings,
and record its owner. Do not ask the product agent to manage the environment.
Open .boat/launch-ready only after all five source copies and caches are ready,
then measure their simultaneous implementation phase. Exclude gate waiting from
iteration timing, but include all preparation/idle VM time in usage accounting.

Collect timestamped host CPU/RAM/swap/disk and per-thread overhead, admission and
readiness durations, source/preview latency, validation results, task hashes,
transferred bytes, failures and recoveries, worker IDs/runtime/provider usage,
the five T3 thread links and draft PR heads. Preserve incomplete runs. Apply the
best-effort $10 cumulative usage cutoff, including preparation. At the threshold
stop admitting work, retain evidence and stop only experiment-owned VMs. Do not
fall back to heavy local execution. Do not pay for start bursts or other features.

After A, audit activity/tool histories for cross-cohort access and record their
limits. Stop A workers and local experiment stacks. Do not start B automatically,
merge any PR, select fixes, close #557/#556, or decide the final operating model.

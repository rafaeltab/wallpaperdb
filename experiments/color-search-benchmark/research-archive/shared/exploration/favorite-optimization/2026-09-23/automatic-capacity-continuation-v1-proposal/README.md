# Persistent full-million capacity continuation (proposal v1)

**Prepared; not launched. Root review is required before the execution command.**

Plan: `continuation-plan-v1.json`

SHA-256: `69878f20d9814cdc0eb2a40b27d8e85227db9f70829166f5473c5c3742a10aeb`

Gate: `continuation-gate.py`. Ten offline readiness/failure tests pass in
`test_gate.py`. The default invocation only validates files and prints readiness;
it creates no output directory and generates no service traffic.

The initial check passed all 54 pinned inputs and correctly reported an unfinished
build: 335,601 acknowledged records, no verified final count, no stored-value audit.
That acknowledgement count is a saved observation, not a million-record result.

## Serial order

1. Wait for both phases of `full-million-build-v1` to finish with exit0, a complete
   one-million-record full-schema receipt, and its verified stored-value audit.
2. Run the unchanged `full-million-comparison-v2-proposal/screen-plan.json` through
   the existing Make pipeline. Four candidates share one numeric-points index.
3. Independently audit its raw capacity evidence.
4. Fixed arrivals at 8, 32, 64 and128 requests/s for30 seconds each; audit.
5. Varied arrivals at the same rates and duration; audit.
6. Broad arrivals at16 requests/s for600 seconds per qualified candidate; audit.

All measurement and audit stages are serial. The existing harness alone controls
candidate qualification from complete strict C1 evidence, warmup failures and
higher-rate skipping. Each arrival workload qualifies independently from the same
screen. A performance failure is retained and does not make otherwise complete,
consistent evidence fail its integrity audit. A measurement/integrity failure
stops continuation. If no candidates qualify, the existing harness's specific
failure becomes terminal `no-qualified-candidates`, not a success or endless wait.

The broad workload schedules9,600 requests per candidate. Only its saved actual
successful coverage can establish traversal of8,184 queries and6,138 utility keys.
The status keeps that coverage and strict failure counts. Shorter wide32/64/128
stress stages are deferred until the broad result is reviewed; a failure at16 is
already useful evidence and does not warrant automatic higher load.

## Readiness and identity

The gate checks files only. It pins the four-candidate config, existing screen
plan, completed maxima fidelity and independent audits, maxima feedback and its
execution-path audit, UI17 QA with closed browser, and the three-shard audit.
Its54 pins also cover recursive scorer/harness/auditor sources, its own script and
the **entire Makefile**. Any change requires a separately reviewed new plan.

The numeric audit must be bound to the exact completed receipt bytes, UUID,
identity and utility-plan hashes. It checks all6,138 values on three deterministic
ordinals; this is not an all-document stored-value scan. Receipt/audit readiness
hashes must remain unchanged throughout the capacity stages.

The six-hour total deadline includes the wait and all tests. Polls are at most30
seconds apart. Child process groups terminate on deadline or signal, preventing
orphaned timing stages. Once execution initializes its directory, status and errors
are saved atomically in`status.json`; logs/raw evidence are retained. Startup pin
or plan errors before directory initialization are reported by the command/unit
log. No automatic restart, resume, overwrite, deletion or service polling exists.

Exclusive ownership of scale service19217 is still required. This file-only gate
cannot prevent an unrelated manual client from generating traffic. The existing
measurement harness also checks settling. Keep visual/browser work stopped while
timing runs; do not reopen the16 inactive scale indexes or edit frozen sources.

## Commands

Default check, safe while the build runs:

```sh
python3 /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/automatic-capacity-continuation-v1-proposal/continuation-gate.py --plan /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/automatic-capacity-continuation-v1-proposal/continuation-plan-v1.json
```

After root review, persistent launch (not executed during preparation):

```sh
systemd-run --user \
  --unit=wallpaperdb-favorite-opt-auto-capacity-v1 \
  --property=Type=exec \
  --property=WorkingDirectory=/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7 \
  --property=StandardOutput=append:/tmp/favorite-opt-auto-capacity-v1.log \
  --property=StandardError=append:/tmp/favorite-opt-auto-capacity-v1.log \
  --property=Restart=no \
  --property=TimeoutStopSec=20s \
  python3 /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/automatic-capacity-continuation-v1-proposal/continuation-gate.py \
  --plan /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/automatic-capacity-continuation-v1-proposal/continuation-plan-v1.json \
  --directory /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/automatic-capacity-continuation-v1 \
  --execute
```

Read the persistent directory's`status.json`, per-stage logs and raw experiment
artifacts. Every output directory must be new. A failed run needs a new reviewed
plan with fresh names; never remove failed evidence to reuse a directory.

# Guarded diagnostic runs

The integrated wrapper schedules the isolated Chromium diagnostic with the
prototype's resource guards, temporary-output ownership and assignment cleanup.
Use the [preparation guide](README.md#prepare-an-isolated-build) first. An existing
native controller must be running; this wrapper does not bootstrap its UI.
Keep instrumented runs outside performance comparison captures.

## Inspect and launch

From the repository root, inspect this configuration without launching anything:

```sh
make native-chromium-diagnostic ARGS='--build-dir /tmp/wdb-chromium-trace-copy --output-dir /tmp/wdb-trace-01 --seconds 12 --black-contender --contender-output DP-5 --contender-fps 360 --passes 100'
```

Use the prepared copy above, or substitute the existing
`/tmp/wdb-chromium-trace-build-c`. The build must already exist even for this
inspection. When the diagnostic is deliberately scheduled, add `--run`:

```sh
make native-chromium-diagnostic ARGS='--build-dir /tmp/wdb-chromium-trace-copy --output-dir /tmp/wdb-trace-01 --seconds 12 --black-contender --contender-output DP-5 --contender-fps 360 --passes 100 --run'
```

Every actual run needs a new, short output directory for its Unix socket path.
The default virtual-output name is `WDB-TRACE` and must be unused; override it
with `--output-name`. Omitting `--black-contender` runs without that synthetic
load. The example contender covers DP-5 with opaque black while retaining 100
fixed 1280×720 offscreen passes at a 360 fps target. Its output and geometry are
validated before recording. This is a synthetic GPU workload, not a game test.

## Lifecycle and limits

The wrapper saves native-controller assignments, clears their assigned outputs,
and creates an owned 3840×2160@360 virtual output. After the owned children stop,
it removes that output and restores the assignments. It preserves any separate
black cover and does not change physical modes, HDR, workspaces or monitor power.

The existing `SafetyMonitor`/`SafetyGuard` checks resources during preparation,
recording and owned-load activity, with an initial cooldown bounded to 120
seconds. The trace itself accepts 1–15 seconds and retains the runner's
20-second child deadline. These are separate budgets; the complete guarded
workflow is longer. [Recording bounds](README.md#recording-bounds-and-evidence)
describe trace memory, flushing and drain limits.

Owned process sessions are registered before deferred spawn signals can unwind.
The runner reserves leader identity using `waitid(WNOWAIT)` and drains surviving
group members before reaping. Guard signalling and final cleanup share the
ownership lock. SIGINT/SIGTERM initiates cleanup; subsequent signals cannot
interrupt the bounded TERM/KILL drain. No unrelated process group is signalled.

The wrapper invokes the isolated runner in-process so its child sessions remain
owned during interruption. It checks that the optional contender stays alive
and requires ready, nonblack NVIDIA diagnostic telemetry at completion. This
last check is specific to the current NVIDIA study; it is not a portable adapter
acceptance test. Guard failure, interruption, failed cleanup or incomplete trace
artifacts remain explicit incomplete results.

## Review the output

The output root contains `guarded-provenance.json` and `guard.csv`, with optional
contender configuration/log/presentation evidence under `contender/`. The actual
trace, source provenance, process roles and stage files are under `trace/`.
Inspect the completion and restoration fields, then analyze that subdirectory:

```sh
make native-chromium-diagnostic-analyze ARGS='/tmp/wdb-trace-01/trace'
```

The generated `diagnostic-summary.md` and JSON describe instrumented callbacks
and stage timings. Overlapping stages, scheduling delays and unresolved GPU
readback cannot be treated as exclusive execution costs. Keep these artifacts
outside the stress comparison inputs and use a fresh directory for each repeat.

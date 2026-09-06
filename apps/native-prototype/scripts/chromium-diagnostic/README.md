# Bounded Chromium bitmap diagnostic

This reusable diagnostic investigates variation between launches of the 4K
Chromium bitmap renderer. It combines Chromium tracing, bounded producer/native
stage records and Electron process roles. Its instrumented results stay separate
from the renderer comparison aggregates.

The tooling is integrated in the repository. An isolated Build C copy at
`/tmp/wdb-chromium-trace-build-c` has been prepared and built successfully.
Two guarded runtime traces completed on 2026-09-06 and were archived under
`verification/chromium-diagnostic-01` and `-02`. Both custom stage buffers
completed; the built-in Chromium trace filled early and covers only about eight
seconds of the roughly 11.8-second custom recording. The earlier 2× variation
did not reproduce. See [the findings](../../STRESS.md#bounded-chromium-trace-follow-up)
for the measured stages and remaining limits.

## Prepare an isolated build

Run these commands from the repository root at a coordinated capture boundary:

```sh
make native-chromium-diagnostic-check
make native-chromium-diagnostic-prepare ARGS='--destination /tmp/wdb-chromium-trace-copy'
```

The check target validates Python and JavaScript syntax. Preparation requires a
new destination outside `apps/native-prototype`; it copies the lab/runtime,
applies checked instrumentation replacements, and writes `diagnostic.patch` plus
source hashes. It does not build or launch. Review the copied patch, then build:

```sh
make -C /tmp/wdb-chromium-trace-copy/lab
```

Instrumentation applies only to this copy. The ordinary renderer and Rust daemon
retain their existing behavior. The generated configuration selects the 3840×2160
heavy shader, SDR bitmap transport and a 360 fps request; Electron's effective
bitmap cap remains 240. To reuse the existing Build C copy, substitute
`/tmp/wdb-chromium-trace-build-c` for the copy path in the run instructions.

## Record and analyze

Use [the guarded run guide](GUARDED.md) for `make native-chromium-diagnostic`.
Without `--run`, that command prints the planned launch after validating its
inputs. The guarded wrapper owns the temporary virtual output, optional black
contender, resource monitoring and assignment restoration. Schedule it separately
from performance comparison captures and use a fresh output directory per run.

After a run written to `/tmp/wdb-trace-01`, analyze its **trace subdirectory**:

```sh
make native-chromium-diagnostic-analyze ARGS='/tmp/wdb-trace-01/trace'
```

This writes `diagnostic-summary.md` and `diagnostic-summary.json` beside the
producer/native stage CSVs. It reports callback rates, stage distributions,
matched frame IDs and process roles. It neither parses the larger
`chromium-trace.json` nor opens a viewer. Check the guarded and trace provenance
results, overflow counters and buffer usage before interpreting a capture.
Missing boundary acknowledgements are retained as unmatched IDs, not automatically
classified as dropped frames.

## Recording bounds and evidence

- Two seconds of post-navigation warmup precede a default 12-second trace;
  `--seconds` accepts 1–15. The Electron subprocess has a 20-second deadline
  including startup, warmup and trace flushing. Graceful cleanup gets at most
  0.5 seconds within that deadline, followed by SIGKILL when required and up to
  one second for drain verification. The surrounding guarded workflow can take
  longer, including its bounded cooldown and output/assignment restoration.
- Chromium uses `record-until-full` with a 32,768 KiB buffer. Custom fixed buffers
  add 1.25 MiB in JavaScript and 1 MiB in C on this ABI. Role snapshots have at
  most 22 polls of 64 processes. These configured event buffers are below 64 MiB;
  this does not bound renderer RSS, GPU memory, internal tracing overhead or
  expanded trace JSON size. Full buffers can omit later events.
- Custom stage records are buffered and serialized after recording, without new
  per-frame file writes. The original bitmap transport still performs its
  existing synchronous shared-file writes. Overflow and sampled Chromium buffer
  usage are recorded; a missing tail cannot establish the absence of stalls.
- Evidence stays in a new mode-0700 local directory. There is no upload, remote
  DevTools endpoint, screenshot capture or automatic viewer. Trace argument
  filtering is enabled; provenance and telemetry can still contain local paths.
  Scene hashing is limited to 256 files and 128 MiB.
- Provenance identifies original/copied sources, instrumented binaries, runtime,
  Electron launcher/versions and the complete scene evidence root. Process role
  snapshots include PID and creation time, with explicit renderer/presenter PIDs.
  Optional cumulative CPU counters produce a separately labelled mean in percent
  of one logical CPU; Electron API CPU samples retain their own units/windows.

## Interpret the stages

| Record | What it measures |
| --- | --- |
| `paint` / `paint_total` | Callback arrivals and synchronous handler duration; a proposed frame ID can repeat before successful submission. |
| `bitmap` | CPU time in `NativeImage.toBitmap()`; GPU readback may already have occurred before the callback. |
| `write` / `submit` | Existing shared-file write and socket submission durations, bytes and acceptance. |
| `ack` | Time from submission until its acknowledgement is observed, including scheduling/polling. |
| Native receive/map/upload/import | Header parsing, mmap, CPU call time in `glTexImage2D`, and total import submission time. |
| Native fence/ack | Delay until fence completion is observed and acknowledgement-send CPU time. |
| Chromium trace | Available compositor, GPU and scheduler events, including pre-paint readback where Chromium exposes it. |

Stages overlap: `paint_total` contains extraction/write/submission and native
`import_total` contains upload. Do not sum their means. Upload CPU time is not
exclusive GPU execution time; fence and acknowledgement delays also include
waiting and scheduling. Paint arrivals are distinct from browser draws and
compositor presentations.

Join producer and native records by frame ID. Producer timestamps use the Node
monotonic clock; native timestamps use `CLOCK_MONOTONIC`. Use durations within
each domain unless their clock relationship has been verified. A wall-clock
anchor provides only a coarse aid. Missing Chromium readback events leave that
attribution unresolved; `toBitmap()` cannot stand in for complete readback cost.
Tracing can change the workload, so retain uninstrumented captures for FPS/CPU
comparisons.

## Primary API references

- [Electron 42.7 contentTracing](https://github.com/electron/electron/blob/v42.7.0/docs/api/content-tracing.md): app-ready requirement, asynchronous child-process start/stop and local trace output.
- [Electron 42.7 TraceConfig](https://github.com/electron/electron/blob/v42.7.0/docs/api/structures/trace-config.md): recording mode, buffer size, category selection and argument filtering.
- [Electron ProcessMetric](https://www.electronjs.org/docs/latest/api/structures/process-metric) and [app.getAppMetrics](https://www.electronjs.org/docs/latest/api/app#appgetappmetrics): process identity, roles and usage fields.
- [Electron 42.7 CPUUsage](https://github.com/electron/electron/blob/v42.7.0/docs/api/structures/cpu-usage.md): baseline observations and optional cumulative CPU time.

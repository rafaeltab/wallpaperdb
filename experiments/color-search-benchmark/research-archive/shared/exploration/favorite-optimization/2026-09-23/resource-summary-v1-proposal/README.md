# File-only resource attribution

`resource_summary.py` reads the saved `resources-v3` kernel observer and optional
completed benchmark/arrival artifacts. It makes no service calls and reads no
live `/proc` or cgroup files. It does not alter any of the continuation gate's
54 pinned sources or the Makefile.

Run its thirteen small offline tests:

```sh
python3 resource-summary-v1-proposal/test_resource_summary.py
```

From this experiment root, write a fresh immutable result directory:

```sh
python3 resource-summary-v1-proposal/resource_summary.py \
  --observer resources-v3 \
  --build-status full-million-build-v1/status.json \
  --campaign full-million-four-methods-v2/benchmark.json \
  --campaign full-million-arrival-fixed-v2/arrival.json \
  --campaign full-million-arrival-varied-v2/arrival.json \
  --campaign full-million-arrival-wide-cycle-v2/arrival.json \
  --directory resources-full-million-completed-v1
```

Only pass artifacts that already exist. For indexing-to-date, omit `--campaign`.
Read heavy completed campaign files between campaigns or after the capacity
run; this script itself consumes some host CPU/RAM and is not part of a timed
query workload.

Each output archives the observer source and metadata, the exact complete JSONL
prefix (gzip), build status, summary source, and reduced campaign resource inputs.
Hashes identify the original campaign files and exact observer prefix. A partial
last JSONL line is ignored and its byte count reported; corrupt complete lines
are rejected. Ongoing phases remain incomplete. Interrupted campaign intervals stop at the
recorded interruption time, preserving the distinction from later host activity. Report only samples inside the
phase, including explicit unobserved edges and maximum sample gap.

## Interpreting the metrics

- **Container memory charge** is separate from anonymous pages, file cache,
  kernel memory and swap. Mapped, dirty and writeback file pages are subsets of
  file cache, not categories to add to it. Individual sampled maxima can occur
  at different times. The cgroup `memory.peak` is a lifetime high-water mark.
- **Entrypoint RSS** comes from observer PID 480753, the container entrypoint.
  It is not the JVM's resident memory. No saved JVM RSS is available.
- **JVM heap, GC and process CPU** come only from saved OpenSearch node samples
  inside benchmark resource brackets. Virtual address space is not physical RAM.
- **Load-generator CPU/RSS** includes query orchestration, response handling,
  metrics and evidence writing. It does not isolate a production gateway's cost.
- **CPU counter deltas** report mean cores over the actual observed window.
  Quota, throttle counters and pressure are separate. Missing values or counter
  resets invalidate the corresponding delta. Failed or malformed JVM resource
  samples remain explicit and invalidate node counter attribution; changed node
  identities invalidate CPU, GC and rejection deltas together.
- **IO is per device.** Devices 259:0 and 252:0 report the same bytes here. They
  can represent layered accounting; summing them would double-count traffic.
- **Host pressure and memory** include unrelated processes. Temporal association
  with a phase is not proof that a method caused the resource usage.

The root agent verified the running observer's ExecStart includes
`--max-seconds 43200`: 12 hours, from 13:27 UTC to approximately 01:27 UTC next day.
The archived metadata omits that argument. The script's 21600-second default is
not the actual invocation; the summary records this provenance distinction.

## Initial indexing-only observation

`resources-indexing-progress-v1/` captures the ongoing build through 16:56:06 UTC.
It covers 1,807 samples over 3,613.6 seconds, with about 1.1 seconds omitted at the
start and 1.6 seconds at the report boundary. Counter coverage is 99.93% of this
incomplete phase interval.

- OpenSearch container CPU averaged **2.374 cores of an 8-core quota**.
- Sampled total charge reached **12.00 GiB**. Anonymous pages peaked at
  **4.61 GiB**, file cache at **7.33 GiB**; these maxima need not be simultaneous.
- Swap charge ended at **0.828 GiB**; swap-in/out counters advanced during the
  phase. It is not merely an unused historical swap allocation.
- `memory.events.max` advanced 69,297; **OOM and OOM-kill deltas were zero** in
  the observed counter window. Limit encounters do not by themselves establish
  an OOM or leak.
- Each layered device reported **83.97 GB read / 345.23 GB written**. Keep these
  per-device values; do not add them. They include container indexing/background
  IO and are not final index storage size.
- Cgroup pressure totals corresponded to approximately 0.36% CPU-some,
  0.070% memory-some and0.91% IO-some of observed wall time. Host counters remain
  separate and include unrelated activity.

These are indexing measurements, not search CPU, query latency, memory retention
per request or a completed million-record capacity result.

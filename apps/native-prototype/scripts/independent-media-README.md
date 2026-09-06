# Independent media evidence analyzer

This tool reads saved profile artifacts. It imports no prototype controls and
opens no sockets, windows or GPU APIs. The analyzer and synthetic tests are
[independent_media_evidence.py](independent_media_evidence.py) and
[independent_media_evidence_test.py](independent_media_evidence_test.py).

For each input `report.json`, keep its run directories beside it:

```text
profile-folder/
  report.json
  1-gpu/
    telemetry.json
    wallpaper-frames.csv
  1-gpu-independent/
    telemetry.json
    wallpaper-frames.csv
```

The reader selects the manifest's `wallpaper_output`, preserves each run's
validity/errors, and analyzes all runs without substituting another output's
telemetry. Legacy renderers can contribute frame CSV counts and presentation
rates; missing independent-media diagnostics remain unavailable. An idle or
unsupported renderer need not have a frame CSV. A CSV advertised by the profile
or expected for the independent/native presenter must be present.

Run the synthetic tests:

```sh
make native-lab-test
```

Analyze two saved comparisons (the output directory must already exist):

```sh
make native-media-evidence ARGS='/absolute/profile-at-120/report.json /absolute/profile-at-360/report.json --json /tmp/media-evidence.json --markdown /tmp/media-evidence.md'
```

The Python CLI also accepts any number of report files or profile directories,
`--json`, `--markdown`, and the thresholds below. With no `--json`, detailed JSON
goes to stdout. Output files must differ from the input artifacts. Exit status 2
means an input/artifact was unreadable or malformed. Timing findings are reported
as evidence, without turning them into a profiler acceptance gate.

## Target timing

The presenter logs `media_target` immediately before the nonblocking libmpv
render call. CSV `value` is raw `NEXT_FRAME_INFO.target_time`; `value2` is a
sampled `mpv_get_time_ns()`; `flags` contains the libmpv next-frame flags.
Filtering uses these official bit values:

| Flag | Value | Treatment |
| --- | ---: | --- |
| PRESENT | 1 | Required |
| REDRAW | 2 | Excluded |
| REPEAT | 4 | Excluded |
| BLOCK_VSYNC | 8 | Excluded; unexpected for this mode |

Unknown flags, malformed/negative values and zero targets are excluded and
counted. Warmup events are excluded using the profile's monotonic start/end.

The current mpv 0.41 implementation forwards a nanosecond timestamp although
the API header describes microseconds. The analyzer therefore makes the unit
assumption visible and checks it before classifying early requests:

1. Positive raw targets and sampled clocks have ratios between 0.5 and 2, and
   every eligible pair differs by no more than the configurable 10 seconds.
2. At least one second of target records exists, the sampled clock does not
   regress, and its elapsed nanoseconds agree with CSV elapsed seconds to 5%.
3. Target progression agrees with sampled clock progression to 5%.

Any incompatible eligible row prevents a due/early verdict for the whole
run. Large offsets are reported as incompatible or a large clock offset, not
silently discarded. These are empirical consistency checks, not proof of
the API timebase. First/last raw pairs, ratio/offset distributions and elapsed
ratios are retained for inspection. Quantiles remain diagnostic under the
nanosecond hypothesis when checks fail; `quantile_units_validated` is false.

Signed lead is `(target - sampled_clock) / 1e6` milliseconds; signed age has the
opposite sign. Both include min, p01, p50, p95, p99 and max using linear
interpolation. Lead greater than `--early-tolerance-ms` (default **0.5 ms**) is
an early render request. Any such row is reported; a strict majority earns
`systematic_early_requests`. A median does not hide early outliers. The estimated
float64 serialization precision is reported separately.

These records establish render-call entry relative to mpv's target. They do
**not** establish early visible presentation, decoding time or an HDR result.
Compositor presentation rates are shown separately for each output, using the
actual presentation timestamp in the CSV `value` column. Multiple span outputs
are never summed into one scene FPS.

Primary API/source references:

- [mpv 0.41 render API flags and target contract](https://github.com/mpv-player/mpv/blob/v0.41.0/include/mpv/render.h)
- [libmpv video output implementation](https://github.com/mpv-player/mpv/blob/v0.41.0/video/out/vo_libmpv.c)
- [Internal nanosecond frame timestamp](https://github.com/mpv-player/mpv/blob/v0.41.0/video/out/vo.h)

## Playback position and loops

`media_properties` values are deduplicated by renderer PID, property name and
completed request/reply timestamps. Identical values with different timestamps
remain distinct samples; cached copies of one reply never create apparent
stationarity or progression. A pending new request does not invalidate the last
completed reply. Conflicting copies are rejected.

Completed samples must have finite values and timestamps, a renderer PID, no
property error, request <= reply, and their entire request/reply interval inside
the measurement window. Default limits are:

| Option | Default | Meaning |
| --- | ---: | --- |
| `--max-property-latency-ms` | 250 | Maximum completed async request/reply interval |
| `--max-property-age-ms` | 2500 | Maximum age when observed; also limits distance to a duration sample |
| `--realtime-tolerance` | 0.10 | Acceptable departure from 1 media second per wall second for compatibility wording |
| `--max-target-clock-offset-seconds` | 10 | Unit/common-base consistency check, not an acceptable lateness target |

Age uses the larger of reported age and the delay since reply at the periodic
status poll. Final boundary snapshots use measurement end as a lower bound on
their observation time, preventing a frozen cached reply from appearing fresh.
The initial boundary cannot import pre-measurement property requests. Missing
timestamps/errors count as unavailable observations; timestamped replies are
deduplicated before sample rejection counts are computed.

The position sample is assigned the midpoint of its request/reply interval;
the real property snapshot occurred somewhere inside that interval. A pair's
wall-time bounds are `next.request - previous.reply` and
`next.reply - previous.request`. The analyzer rejects:

- Paused samples or unknown pause state, overlapping/reordered intervals,
  positions outside the source duration, or a missing nearby duration sample.
- Every interval whose **upper wall-time bound is >= the source duration**.
  This includes a nearly duration-sized gap made ambiguous by async uncertainty.
- Whole-stream unwrapping when a renderer restart is observed or measured
  source duration changes beyond the larger of 1 ms and 0.01% of duration
  (`max(0.001 seconds, duration * 0.0001)`).

A backward change greater than 1 ms is a **single-wrap candidate**, adding one
duration. Smaller backwards jitter is clamped to zero. The result assumes no
seeking and at most one loop in that accepted interval; it is not an observed
EOF event. A seek can imitate a loop, and sufficiently fast complete loops
between samples can alias. The analyzer reports this limitation explicitly.

The aggregate position advance is divided by the sum of accepted midpoint
intervals, with a separate range obtained from request/reply timing bounds.
Classification needs at least three accepted intervals spanning three seconds.
`compatible_with_realtime` means that timing range overlaps the configured 1x
tolerance. Other labels distinguish faster/seek-like and slower/paused-like
evidence. No position rate is inferred from a duration-sized gap or from mere
media render counts.

Coverage is the accepted interval duration divided by measurement duration;
read it together with rejected intervals, last-reply age and individual rates.
A compatible rate over a short observed segment cannot establish progression
through an unsampled or stale tail. Timing bounds describe async latency;
they do not account for frame quantization or every source of clock error.

## Counts and freshness

The exact CSV measurement window reports scene submission rows (`cpu` events),
media render rows (`media` events), and per-output presentation feedback. Media
render call Hz is never labelled decoded FPS.

Independent cumulative render/update/reuse/new-frame/redraw/repeat/report-swap
counters are differenced between reports inside the measurement window. Their
report time is reconstructed from completed reply timestamp plus reported
property age. The sampled counter interval, duration and coverage are included;
unsampled measurement edges are excluded. Any observed counter decrease removes
its delta/rate rather than treating it as negative work. Renderer changes also
disable counter differencing.

Drop properties (`decoder-frame-drop-count` and `frame-drop-count`) retain
first/last values, sample freshness, decreases and a sampled delta only when no
reset was observed. Endpoint differences cannot detect an unobserved reset.
`container-fps` and `estimated-vf-fps` remain descriptive metadata/estimates.
Neither they nor render/reuse counters provide a decoded-frame denominator for
a drop percentage. See the [official property definitions](https://github.com/mpv-player/mpv/blob/v0.41.0/DOCS/man/input.rst).

## Synthetic coverage

Tests exercise ordinary multi-loop unwrap, duration-sized and nearly
duration-sized ambiguous gaps, stale cached replies, bounded async latency,
equal fresh values versus duplicate replies, pause exclusion, duration changes,
warmup exclusion, drop counter reset, final cached boundary staleness, due and
50 ms early requests, early outliers, incorrect target units, redraw/repeat/zero
target exclusion, per-output/windowed CSV counting and output selection.

These synthetic tests do not import the repository profiler or run the actual
presenter. Apply the analyzer to saved 120/360 comparisons after capture and
inspect timing, coverage, validity and HDR evidence together.

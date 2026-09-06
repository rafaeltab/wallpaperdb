# 4K stress laboratory

This is a disposable extension to the renderer prototype. It asks how the renderers
behave with a busy 3840×2160 scene and 120–360 fps targets, especially their long
frame-time tails when other GPU work competes with them. The earlier ~1.24% CPU
measurement used a lightweight 1080p/30 fps scene; it is not a 4K performance claim.

## Try it

```sh
make native-build native-lab-build
make native-stress-assets
make native ARGS='add apps/native-prototype/examples/stress-studio'
make native ARGS='add apps/native-prototype/examples/stress-studio/shader-light'
make native ARGS='add apps/native-prototype/examples/stress-studio/shader-heavy'
make native ARGS='add apps/native-prototype/examples/stress-studio/media-heavy'
make native-lab
```

Select a **Stress studio** wallpaper and use the renderer dropdown. **Native ·
Compositor-paced Lua / GLSL**, **Native GPU · independent media clock**, and
**Native GPU · independent video with frame dropping** are the additional
experiments. The frame-budget dropdown offers
120, 240 and 360 fps. Existing renderers and wallpapers remain available.

The scenes share one literal GLSL body between WebGL2 and Lua/OpenGL. They contain
a rotating multi-object sculpture, multiple moving lights, layered noise, stars,
audio spectrum, pointer response and a date/time display. Light, standard and heavy
presets use 12/24/40 ray steps, 2/3/4 noise octaves and 4/8/12 lights respectively.
Media heavy also samples one genuine 3840×2160/60 fps video through the same shader.
The clip lasts 8 seconds, making repeated decoder loops observable in long runs.
See [scene authoring and fixture details](examples/stress-studio/README.md).

## Reproduce the measurements

```sh
make native-stress ARGS='--list --stage all'
make native-stress                         # Short feasibility screen first
make native-stress ARGS='--stage sweep'     # Light/heavy at a 360 fps target
make native-stress ARGS='--stage sustained' # Three paired repeats at 120/360
make native-stress ARGS='--stage files'     # Standalone 4K image/video controls
make native-stress ARGS='--stage media'     # Two repeats with 4K60 video composition
make native-stress ARGS='--stage soak'      # Longer native media runs
make native-stress ARGS='--stage paused'    # Retained 4K media with animation paused
make native-stress ARGS='--stage sustained --contender-output DP-5 --contender-fps 360 --contender-black --passes 100 --repeats 2'
make native-stress ARGS='--stage media --only media-360 --engines idle,gpu,gpu-independent --no-contender --seconds 30 --repeats 2'
```

The runner creates its own **WDB-STRESS** headless output at 3840×2160@360, and
removes it afterward. It does not change any physical display mode. This machine's
360 Hz display is 2560×1440 and DP-2 is 1920×1080@144, so a virtual output is necessary
to submit a real 4K canvas without upscaling. Its presentation feedback proves
virtual presentation, not physical 4K/360 Hz scanout or actual panel response.

The hardware is a Ryzen 9 7950X with 93.4 GiB of usable RAM and an RTX 4080
with 16 GiB VRAM, running NVIDIA 610.43.03. DP-5 is attached to the NVIDIA DRM
device; DP-2 scans out through the AMD integrated GPU. The tested native and
Chromium renderers identify the RTX 4080. Thus DP-2 and DP-5 contenders exercise
different display paths as well as different refresh rates and pass counts.

The sustained/media/soak stages add a fixed 1280×720 synthetic shader contender on
**DP-2**, targeting 144 fps. This is a repeatable competing graphics workload, not
a measurement of FPS in a particular game. Requested rates, actual presentation
counts, interval p95/p99/p99.9/max, submission/GPU timers and resource samples are
recorded separately. WebKit callbacks cannot prove pixel delivery; that limitation
must remain visible in comparisons.

An optional contender mode presents opaque black over a complete physical output
while retaining the same offscreen shader passes. Use `--contender-output DP-5
--contender-fps 360 --contender-black` with a contention stage to test physical
360 Hz refreshes. Calibrate the pass count with an idle control first: the default
600 passes targets a 144 Hz comparison and can exceed a 360 Hz frame budget by
itself. The black presentation surface uses the selected monitor's geometry;
the offscreen contender remains 1280×720. A separate cover can remain underneath
between cases. This changes the contender's final copy/clear and scanout path, so
compare black-mode runs against their own controls.

Every batch saves detailed JSON/CSV and an interactive frame-time report. The
top-level `index.html` compares runs and links their charts. Filter by batch before
comparing rates. Less CPU use at a lower delivered rate is not sufficient evidence
of better efficiency. Frame-sequence gaps are interpreted against the target rate:
three 360 Hz refreshes per frame are normal at 120 fps.

CPU means integrate process-counter deltas over time and use **percent of one CPU
core**: 100% means one fully occupied core. Wallpaper CPU includes the controller
and observed renderer family; compositor, profiler, contender and existing
background processes are reported separately. GPU load, power, memory and decoder
activity are whole-device readings, including other applications. The existing
desktop `mpvpaper` video continues beneath the temporary cover; the newly opened
browser video is paused. Idle controls retain that same desktop background.
These are measurements on an active desktop, not a clean-room isolation of every
GPU client. Per-run process snapshots expose background CPU activity.
Renderer comparisons disable audio capture; input behavior is checked separately.
The pointer is observed and recorded, and animation/date/time continue to advance.
Shared shader parameters and fixture hashes match, but sequential runs do not
render an identical frozen scene phase at every instant.

The ray marcher exits early on a hit or escape. Hit pixels also perform extra
field evaluations for normals and lighting, so animation phase changes the actual
GPU work. Ordinary scenes receive wall-clock phase and live, unclamped pointer
coordinates even when the cursor is outside the virtual output. These are recorded
comparison limits, not proof of the cause of any particular slow repeat.
The separate [fixed heavy control](examples/stress-studio/fixed-heavy/README.md)
holds all shader inputs constant and verifies their actual uniform values during
warmup. It redraws the same pixels continuously. Wrapper overhead and browser
damage handling still differ; removing media, centering the pointer and freezing
the scene also mean this control cannot isolate the cause of earlier media variance.

The detailed presentation traces retain every recorded interval. The portable
comparison report bins plotted intervals into 100 ms windows and retains each
window's maximum, so plotting cannot average away a hitch. Its statistics remain
the original per-run percentiles. A median of three per-run p99 values is labeled
as such; it is not a p99 recomputed across all frames. GPU elapsed queries are
collected asynchronously, may include other queued work, and are selected by read
time; they cannot be aligned directly to a presentation spike as exclusive GPU
execution time. The native query also surrounds the libmpv render call: CPU-side
waiting between submitted GL commands can fall inside its elapsed span. Chromium
readback, transfer and texture import occur outside its presenter query. These
timer scopes do not provide a like-for-like measure of total renderer GPU cost.
[Khronos timer-query semantics](https://github.com/KhronosGroup/OpenGL-Registry/blob/main/extensions/ARB/ARB_timer_query.txt).

Resource guards record actual free VRAM, available system RAM and temperatures;
they stop escalation on failed rendering or abnormal resource pressure. On this
7950X, 95°C is a normal boost target; the default CPU anomaly guard is 96°C sustained
for 3 seconds. GPU and memory guards are independent. Process groups, output cleanup
and assignment restoration are bounded, including interruption paths. No clocks,
voltages, fan curves, power settings or monitor power commands are changed.
[AMD 7950X specification](https://www.amd.com/en/products/processors/desktops/ryzen/7000-series/amd-ryzen-9-7950x.html),
[Electron bitmap FPS limit](https://www.electronjs.org/docs/latest/api/web-contents#contentssetframeratefps).

For unattended work, a separate optional helper covers the OLED output in black
without changing its power state and holds an idle/sleep inhibitor:

```sh
make native-benchmark-cover
# Optional: pause one known MPRIS player and resume that same track on exit.
make native-benchmark-cover ARGS='--pause-player firefox.instance_1_64'
```

Stop it with Ctrl-C. It expires after 3 hours by default. It blocks no keyboard
focus or pointer input; the cover is a separate Wayland layer. The default output
is DP-5. The existing Hypridle configuration must honor systemd idle inhibitors.

## Evidence and interpretation

Earlier 30 fps findings remain separately recorded in [RESULTS.md](RESULTS.md).
The first 50 stress captures use build A. Build B adds reviewed covered-output
pacing, shutdown and evidence fixes. Build C adds the independent media-clock
experiment, pause heartbeats and stricter process-clock evidence. The original
independent behavior is preserved in build D, which adds the opt-in decoder-drop
mode and updates the embedded UI. Later harness revisions add fixed-input and
sampler-off controls, stricter cleanup and policy checks; each report retains
its own source and binary hashes. The original
shader and 4K60 fixture bytes remain unchanged; newly generated 4K120/360 files
change the containing bundle hash. The report groups by study, batch, build and
engine and retains the hashes. Compare within matching conditions.

### Capacity screen: 4K standard shader, no synthetic contender

Each cell below comes from one 15-second capture after warmup. These show capacity;
the repeated contention studies are the evidence for consistency under load.

| Renderer | CPU at 120 request | Presented fps | CPU at 360 request | Presented fps |
| --- | ---: | ---: | ---: | ---: |
| Native fixed | 1.92% | 120.00 | 4.31% | 359.93 |
| Native paced | 1.92% | 119.20 | 4.12% | 353.07 |
| Chromium bitmap | 185.81% | 55.93 | 193.70% | 94.33 |
| WebKit baseline | 124.46% | Unavailable | 122.23% | Unavailable |

Chromium's effective cap is 240 at the 360 request. Browser animation callbacks
are separate from delivered output: WebKit reported about 29–30 callbacks/s here.
All three scene implementations reported a real 3840×2160 drawing buffer. The
native and Chromium paths identify the RTX 4080. WebKit's exposed `Apple GPU`
string is a generic implementation value on this Linux stack, not evidence of
Apple hardware or a specific adapter.
[WebKit implementation](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/canvas/WebGLRenderingContextBase.cpp#L2026-L2034).

A separate device probe found NVIDIA device handles in the WebKit web process
and observed that same process doing GPU work through `nvidia-smi pmon`. This
supports NVIDIA acceleration in that probe. It does not retroactively identify
the adapter for each earlier measurement, whose own telemetry retains the generic
renderer string.

### Repeated contention: 4K heavy shader against the DP-2 contender

Three 60-second captures per renderer/rate, alternating forward and reverse order.
CPU is the median of the three time-weighted means; FPS columns show the full
per-run range. The contender targets 144 fps with 600 offscreen passes.

| Target | Renderer | CPU median | Wallpaper fps range | Contender fps range | Worst contender interval across repeats |
| --- | --- | ---: | ---: | ---: | ---: |
| 120 | Idle control | 0.22% | — | 143.65–143.90 | 13.89 ms |
| 120 | Native fixed | 2.06% | 119.98–120.00 | 143.62–143.75 | 13.89 ms |
| 120 | Native paced | 2.11% | 119.17–119.18 | 141.67–143.88 | 13.89 ms |
| 120 | Chromium bitmap | 179.48% | 44.58–83.55 | 132.37–143.73 | 13.89 ms |
| 120 | WebKit baseline | 108.26% | Unavailable | 110.53–127.42 | 20.84 ms |
| 360 | Idle control | 0.23% | — | 143.55–143.98 | 13.89 ms |
| 360 | Native fixed | 3.35% | 242.75–255.78 | 118.98–126.47 | 48.61 ms |
| 360 | Native paced | 2.95% | 200.28–245.53 | 125.75–143.98 | 20.83 ms |
| 360 | Chromium bitmap | 187.46% | 41.67–42.88 | 113.93–135.60 | 20.83 ms |
| 360 | WebKit baseline | 107.72% | Unavailable | 118.77–131.33 | 20.84 ms |

Low CPU is real, but it does not imply negligible GPU interference. Fixed native
at 120 fps preserved the contender's usual 6.95 ms p99 in all three repeats. At
the 360 request, its contender p99 was 13.89 ms in every repeat, and one run
contained a 48.61 ms interval. A p99 alone would conceal that rare outlier.
This records a hitch during the native case; the traces do not establish an
exclusive cause for that individual event.

Pacing traded wallpaper throughput for more contender refresh opportunities at
the saturated 360 target. Its advantage varied substantially between repeats and
did not extend uniformly to the 120 target. It is a useful switch to investigate,
not a demonstrated guarantee of stable game FPS.

### Physical 360 Hz contender: 4K heavy shader

Two 60-second captures per renderer/rate on the reviewed build. The wallpaper
still renders at 4K on the virtual output; the contender presents a full black
2560×1440 surface on DP-5 at a 360 fps target, with 100 fixed 1280×720 offscreen
passes. This is a different contention level and scanout path from the DP-2 test.

| Target | Renderer | CPU median | Wallpaper fps range | Contender fps range | Worst contender interval |
| --- | --- | ---: | ---: | ---: | ---: |
| 120 | Idle control | 0.21% | — | 351.60–353.32 | 22.29 ms |
| 120 | Native fixed | 1.89% | 120.00 | 355.58–357.18 | 6.13 ms |
| 120 | Native paced | 1.93% | 119.17–119.18 | 355.60–356.52 | 6.12 ms |
| 120 | Chromium bitmap | 165.50% | 56.23–84.42 | 353.50–355.45 | 6.98 ms |
| 120 | WebKit baseline | 115.08% | Unavailable | 348.32–350.25 | 9.64 ms |
| 360 | Idle control | 0.21% | — | 352.92–354.87 | 6.11 ms |
| 360 | Native fixed | 4.09% | 359.32–359.58 | 333.13–342.33 | 7.17 ms |
| 360 | Native paced | 4.00% | 352.63–352.83 | 347.32–350.27 | 6.12 ms |
| 360 | Chromium bitmap | 197.02% | 49.08–97.50 | 348.70–352.50 | 6.76 ms |
| 360 | WebKit baseline | 112.40% | Unavailable | 341.05–345.98 | 8.88 ms |

DP-5 supplied VSYNC/hardware-clock/hardware-completion feedback flags, but all
refresh sequence increments were zero. The timestamps and rates remain evidence;
sequence-based missed-slot estimates remain unavailable. The shorter calibration
without the virtual output reached 359.75 fps at 100 passes; the actual study's
idle controls are the relevant baseline. The 22.29 ms idle outlier and native
120 cases exceeding their idle controls demonstrate background/run variation.

The wallpaper-family CPU figures exclude the compositor and recorder, which have
their own measured roles. At the 360 target, median Hyprland CPU was 12.26% of one
core in idle, 15.93% with fixed native, 15.90% with paced native, 17.83% with Chromium,
and 21.12% with WebKit. Profiler means ranged from 0.69% in idle to 1.49% with
Chromium. Whole-device GPU activity medians were roughly 50%, 91%, 89%, 77% and 70%
respectively. These additional costs help explain why wallpaper CPU alone is an
incomplete performance score; rates and work delivered differ between paths.

The two 360-target Chromium repeats differ before final presentation. Received,
submitted and presented rates track closely, and both recorded zero application
producer drops and zero compositor discards. Ten-second delivery bins stay around
96–98 versus 47–51 fps: the slow average is not one brief stall. Graphics clocks
were 2760–2775 MHz, and GPU temperatures stayed modest, so these observations do
not support thermal clock reduction as the explanation. Background application
activity remains a confound, and current presenter timers exclude rendering,
readback, IPC and import. Producer tracing is needed to separate those costs.

### Heavy live scene with 4K60 video

Two 60-second captures per renderer/rate with the DP-2 144 fps contender and
600 passes. CPU is the median of the two means; FPS columns show both repeats.

| Target | Renderer | CPU median | Wallpaper fps range | Contender fps range | Worst contender interval |
| --- | --- | ---: | ---: | ---: | ---: |
| 120 | Idle control | 0.23% | — | 142.93–143.80 | 13.89 ms |
| 120 | Native fixed | 4.15% | 60.35–60.40 | 142.50–144.00 | 13.89 ms |
| 120 | Native paced | 4.25% | 60.42 | 141.47–143.78 | 13.89 ms |
| 120 | Chromium bitmap | 190.46% | 27.92–33.78 | 110.10–139.47 | 13.89 ms |
| 120 | WebKit baseline | 216.18% | Unavailable | 103.42–109.13 | 20.84 ms |
| 360 | Idle control | 0.23% | — | 143.83–143.98 | 13.89 ms |
| 360 | Native fixed | 4.10% | 61.28–61.33 | 141.15–143.93 | 13.89 ms |
| 360 | Native paced | 4.26% | 60.75–60.97 | 132.57–134.58 | 13.89 ms |
| 360 | Chromium bitmap | 210.34% | 29.72–30.08 | 134.05–139.52 | 13.89 ms |
| 360 | WebKit baseline | 217.96% | Unavailable | 123.65–130.40 | 20.83 ms |

The native modes deliver about 60–61 scene frames per second despite the higher
request. Their current libmpv render call waits for the video's target time on
the scene thread. These measurements therefore do not demonstrate native 4K/360
video composition. Media render updates stayed near 60/s; that counter measures
render calls, not independently observed decoder output. The standalone shader
and video-heavy results answer different questions and must not be compared as
equal delivered work.

### Standalone 4K image and video controls

One 30-second capture per case after warmup, without the synthetic contender.
The request remains 360 fps; the video source contains 60 frames per second.

| Path | Still-image CPU | Still-image presented fps | Video CPU | Video presented fps |
| --- | ---: | ---: | ---: | ---: |
| Baseline (GTK image / mpvpaper video) | Unknown in original capture | Unavailable | 3.23% | Unavailable |
| Native fixed | 1.00% | 0, retained image | 3.42% | 61.53 |
| Native paced | 1.04% | 0, retained image | 3.65% | 61.60 |
| Chromium bitmap | 53.62% | 19.97 | 120.39% | 78.97 |

Zero new image presentations after warmup is expected when the compositor retains
the already displayed buffer. Native nevertheless keeps some polling/telemetry
overhead, while Chromium continues transferring an unchanged image. A production
implementation should route stationary content through an event-driven retained
texture path. The browser live-scene result does not describe ordinary baseline
video playback: the latter uses mpvpaper and costs much less CPU here.

Video presentations can include repeated source content. In particular, 78.97
Chromium presentations per second cannot represent 78.97 distinct decoded frames
from this 60 fps source. Source rate, playback progress, media render updates and
surface presentation rate remain separate evidence.

The original baseline image capture lost process-clock access when GTK's Glycin
image-loading sandbox exited after its normal idle timeout. Its daemon was
observed throughout, but the full family's final CPU counters were unavailable.
The portable report therefore withholds that CPU result instead of treating
missing children as zero. A fresh capture with the stricter sampler deliberately
failed validation on the same exit. A subsequent 35-second warmup allowed the
helper to exit before measurement: all three 30-second controls passed, with
0.20% idle, 0.22% baseline and 1.06% independent-native CPU. These are steady-state
retained-image costs, excluding loading and sandbox startup/shutdown.
[Glycin loader lifecycle](https://github.com/GNOME/glycin#sandboxing-and-inner-workings).

The retrospective audit verified frozen process membership and sweep coverage
for 102 of the original 103 completed captures; the image case above is the sole
exception. Old raw reports remain unchanged. A SHA-256-matched audit overlay
withholds unsupported statistics in the comparison. New captures record per-PID
CPU counters, sample times, worker completion and explicit read failures. CPU
means need near-complete window coverage; tails additionally need bounded sample
gaps. Sampling at 20 Hz cannot resolve CPU bursts shorter than its 50 ms interval.

### Independent scene and video clocks

The additional native mode changes the video scheduling contract rather than
changing the shared shader. It disables libmpv's target-time blocking, uses its
system-clock fallback for silent media, consumes update notifications and retains
an FP16 texture between new video frames. A successful group submission acknowledges
each actual media update once. Existing fixed and paced modes remain available.
See [the implementation and evidence contract](scripts/independent-media-README.md).

Four repeated 60-second contention captures passed at 120 and 360 scene targets.
The 120 cases presented 119.42–119.72 fps at 5.06–5.28% of one core. At the saturated
360 target, they presented 217.23–226.20 fps at 6.27–6.34%, while the old native
paths remained around 61 fps. This is greater delivered scene work, and it also
changes GPU contention; lower-rate old media captures are not equal-throughput
efficiency controls.

Two 30-second capacity controls removed the contender. Independent native
presented 359.97 fps in both at 6.68–7.01% of one core, while the old path presented
61.53–61.60 at 3.26–3.38%. Thus 4K360 scene animation with a 4K60 video texture was
observed. This does not mean that a 60 fps source contains 360 unique video frames.

The saved asynchronous position samples in all four contention captures were
compatible with real-time playback: approximately 0.997 media seconds per wall
second over 96.8% of each measured window, with seven single-wrap candidates per
capture. Sampled decoder/display drop counters stayed at zero. Each capture logged
about 3,590 eligible media targets, with no render requests more than 0.5 ms early.
Median render-call entry was 5.44–7.07 ms after target at 120 and 1.75–1.91 ms after
target at 360. These are conditional clock/property observations, not independent
decoded-frame counts or physical display latency. Header/source target-time units
disagree in the installed mpv; the analyzer explicitly checks its nanosecond
interpretation before classifying timing.

### Three-minute video-loop checks

The original native media paths each completed a 180-second capture with the
4K60 eight-second clip and DP-2 contender. Their scene throughput remained
60.7–62.3 and 60.7–62.0 fps across ten-second windows. Wallpaper intervals peaked
at 27.04 and 26.38 ms respectively, with no interval over 50 ms in either capture.
This is evidence across repeated short media loops, not an overnight endurance
test or proof that every source will loop seamlessly.

The competing workload varied more than these wallpaper averages suggest:
ten-second contender rates ranged from 117.4–144.0 fps with fixed native and
130.6–144.0 with paced native, versus 137.9–144.0 in the idle control. Both native
cases raised contender p99 from 6.95 to 13.89 ms. Their 20 Hz CPU p99 values were
8.57% and 8.48% of one core, compared with means of 4.24% and 4.07%. All recorded
contender intervals stayed below 13.90 ms in this particular soak. The timelines
matter: even without a very long single hitch, clusters of missed refreshes can
make a competing application feel uneven.

### Genuine 4K120 and 4K360 video files

These are one 30-second capture per path/source, without a synthetic contender.
The [source-generation record](scripts/high-fps/README.md) verifies encoded frame
count and timestamps. Existing background video remains active. Source FPS,
surface presentations and video texture updates are separate quantities.

| Source | Path | CPU, one core | Presented fps | Native media render updates/s |
| --- | --- | ---: | ---: | ---: |
| 120 | Baseline mpvpaper | 3.61% | Unavailable | Unavailable |
| 120 | Native fixed | 5.45% | 120.00 | 119.73 |
| 120 | Native paced | 5.31% | 119.20 | 119.07 |
| 120 | Native independent | 5.36% | 120.00 | 119.77 |
| 120 | Chromium bitmap | 183.80% | 60.13 | Unavailable |
| 360 | Baseline mpvpaper | 3.26% | Unavailable | Unavailable |
| 360 | Native fixed | 7.06% | 358.40 | 28.23 |
| 360 | Native paced | 7.30% | 351.97 | 28.30 |
| 360 | Native independent | 7.52% | 358.63 | 17.43 |
| 360 | Chromium bitmap | 171.06% | 54.07 | Unavailable |

**The 360 source did not achieve full-rate video playback.** All active 360 cases
recorded 100% whole-device decoder activity throughout their measured windows;
the idle control averaged about 27%. Native presentation rates near 360 mostly
repeat older video content. Independent native advanced at approximately 0.556×
normal playback speed over 93.4% of the observed window. Its output-drop counter
was high and reset across loops; subtracting final minus initial would hide drops.
The decoder-drop counter stayed zero, which is compatible with decoding frames
and dropping them later at video output. These counters do not supply an
independently measured decoded-frame denominator.

By comparison, the independent 120 source advanced at approximately 0.998× speed
with no increase in its sampled drop counters. Chromium's browser video display
accounting is distinct again from its compositor presentation count. Baseline
mpvpaper exposes source FPS and playback position here, not delivered FPS; its
periodic clock-alignment seeks also mean position advancement cannot establish
smooth playback. Low CPU in that path is not proof that the source rate was met.

The comparison report explicitly places media render updates next to presented
FPS, and excludes mpv's container FPS from browser-callback statistics. The
library status no longer combines these incompatible counters into one FPS
number. A separate decoder-only diagnostic completed both full files through
NVDEC into a GPU-resident null output, with exactly 960 and 2,880 decoded frames
and no reported duplicates or drops. FFmpeg's measured decode throughput was
206.01 and 206.57 frames/s respectively; including process startup, it was 197.26
and 203.09. This is consistent with the observed approximately 0.56× playback of
the 360 source. It verifies successful full-file decoding, not a decoded-pixel
hash or the RTX 4080's exclusive decoder capacity. The existing background video
remained running and its process identity was checked before and after. These
diagnostic numbers are kept outside the renderer comparison.

### Fixed-input heavy control and sampling overhead

Three 30-second repeats per path held the actual shader uniforms constant:
40 ray steps, four octaves, twelve lights, phase 137, centered pointer, silent
audio, fixed date and no video. All twelve active runs verified those uniforms
through OpenGL/WebGL reads during warmup. The common shader remains unchanged;
adapter overhead, browser damage handling and graphics pipelines still differ.

| Path | CPU median, one core | Wallpaper presentations/s | Contender presentations/s | Contender p99 | Worst wallpaper interval |
| --- | ---: | ---: | ---: | ---: | ---: |
| Idle | 0.24% | — | 143.93–144.00 | 6.95 ms | — |
| Native fixed | 3.55% | 248.10–263.03 | 106.97–135.00 | 13.89 ms | 12.10 ms |
| Native paced | 3.27% | 240.07–250.90 | 142.67–143.83 | 6.95 ms | 11.69 ms |
| Chromium bitmap | 187.59% | 43.27–45.20 | 107.07–138.63 | 13.89 ms | 76.31 ms |
| WebKit baseline | 106.72% | Unavailable | 119.33–131.37 | 13.89 ms | Unavailable |

Paced native kept the contender much closer to its idle throughput at similar
wallpaper throughput. This is the strongest controlled evidence here for paced
submission on this shader/driver/compositor combination. The Chromium wallpaper
had 22, 16 and 12 intervals over 50 ms in the three runs. Those are wallpaper
intervals; the contender had no interval over 50 ms in these runs.

Two additional repeats disabled periodic CPU sampling and status polling while
retaining frame traces, GPU queries and resource guards. Fixed native still
presented 245.00–262.37/s, while the contender presented 104.17–136.63/s and had a
13.89 ms p99. The periodic observer cannot be the sole explanation for this
contention loss. This does not establish zero observer overhead. CPU stays
explicitly unavailable in these four valid controls. A separate two-run smoke
is retained as feasibility evidence, outside this paired comparison.

### Paused media and periodic CPU bursts

Two 45-second repeats per path used the retained 4K media scene and DP-2
contender. All ten paused cases passed their work/freshness gate; both idle
controls also passed. Native and Chromium presenters recorded zero new frames,
submissions and presentations. Browser host events and observed media positions
remained stable with fresh one-second reports. WebKit's delivered presentation
count remains unavailable. These checks do not cover arbitrary independent
JavaScript timers, CSS animation, every decoded frame or every pixel.

| Path | CPU median, one core | Largest sampled CPU interval | Contender presentations/s | Worst contender interval |
| --- | ---: | ---: | ---: | ---: |
| Idle | 0.25% | 4.53% | 142.49–143.91 | 13.89 ms |
| WebKit paused | 1.55% | 93.67% | 142.11–143.82 | 13.89 ms |
| Native fixed paused | 1.20% | 6.24% | 143.11–144.00 | 13.89 ms |
| Native paced paused | 1.24% | 6.53% | 142.51–143.91 | 13.89 ms |
| Native independent paused | 1.32% | 7.38% | 143.96–143.98 | 13.89 ms |
| Chromium paused | 2.45% | 95.38% | 142.80–143.49 | 13.89 ms |

CPU intervals are approximately 50 ms, not instantaneous peaks. Baseline bursts
recurred about every 10.050 seconds and involved both the controller and
WebKitWebProcess. The controller contributed about 50.8–53.7% of one core in
those intervals. Chromium's dominant burst occurred about 7.05–7.10 seconds into
both windows and came from one Electron child; the native presenter stayed nearly
idle. The saved topology does not identify that child's Electron role. These
samples locate work in processes and time, without establishing its underlying
cause. Contender intervals within 250 ms of the bursts stayed at or below
13.89 ms for baseline and 6.95 ms for Chromium.

Thus the small paused averages hide bursts, but these captures do not show the
bursts causing long contender stalls. Whole-device decoder utilization remained
about 26–29% even when wallpapers were paused or absent, consistent with the
preserved background video. It cannot be attributed to the paused wallpaper.

### Independent-clock three-minute follow-up

The new clock completed one 180-second run with the same 4K60 media-heavy scene
and DP-2 contender. It submitted 234.14 scene frames/s and actually presented
219.19/s, with 59.83 libmpv media render calls/s. Sampled video progression was
0.9971× over 98.48% of the window, with 22 loop candidates and no increase in
sampled mpv drop counters. All 10,770 eligible target records passed clock checks;
none entered rendering more than 0.5 ms early.

Wallpaper interval p99/p99.9/max were 10.79/12.30/19.31 ms; contender values were
13.89/13.89/13.89 ms. Ten-second wallpaper rates ranged 204.3–233.7/s, contender
rates 113.3–144.0/s, while media calls stayed at 59.7–59.9/s. The compositor
reported 2,693 discarded wallpaper buffers: zero mpv drops does not mean every
scene buffer was presented. Boundary-timed counts are not an exact partition.

Wallpaper CPU averaged 6.28% of one core, with sampled p99/p99.9/max of
11.56/14.37/16.14%. Hyprland separately averaged 51.97% and the profiler 0.95%.
Whole-device GPU utilization was 99–100%, with 285.12 W mean power. This is a
saturated scene and a single loop-stability observation, without a contemporary
idle soak. It is not an overnight endurance test, a memory-leak exclusion or a
game-performance guarantee.

### Decoder-drop overload experiment

The new `gpu-independent-drop` option sets `framedrop=decoder+vo` and verifies
mpv's applied policy at initialization. Two 30-second repeats per mode used
identical 4K360 source bytes, without a contender. Both new-mode readbacks passed.

| Mode | CPU range, one core | Presentations/s | Media render calls/s | Sampled playback speed |
| --- | ---: | ---: | ---: | ---: |
| Independent | 7.58–7.59% | 358.60–358.70 | 17.00–17.20 | 0.5604–0.5608× |
| Independent with decoder dropping | 7.30–7.66% | 358.13–358.33 | 16.47–16.93 | 0.5604–0.5605× |

**The option did not solve the tested overload.** Every measured decoder sample
was 100%; sampled decoder-drop counters remained zero. Output-drop counters
rose above 2,500 and decreased twice across loops, so a final-minus-initial drop
total is withheld. Normal-speed position bounds overlap between modes. Media
target-age p99 was about 198–200 ms: absence of early requests is not evidence
of timely content delivery. The option remains available as a negative experiment,
without generalizing its failure to every source or decoder backend.
[mpv frame-drop policy](https://mpv.io/manual/stable/#options-framedrop).

### Bounded Chromium trace follow-up

Two separate instrumented launches used the same 4K heavy shader with the black
DP-5 360 Hz contender at 100 passes. The custom event buffers completed, with
paint arrivals of 96.56 and 95.41/s and 1,140/1,130 accepted submissions. These
runs did not reproduce the earlier 2× launch variation. One final unobserved
acknowledgement per run is retained as a boundary observation, not called a drop.

Electron's Browser process averaged about 105% of one core in both diagnostics;
GPU process CPU was about 32%, Tab about 18%. Mean producer `toBitmap` time was
2.02 ms and shared-file write time 5.20–5.26 ms. The presenter texture-upload call
averaged 3.42–3.47 ms. Stages overlap and must not be added. GPU readback can occur
before paint delivery; `toBitmap` is not a complete readback measurement.

The built-in trace records 776/762 paired copy-output requests with mean
asynchronous latency 3.51/3.53 ms and p99 6.65/6.44 ms. That is not isolated GPU
execution time. The configured trace buffer reached about 99.37% usage; retained
copy/GPU events cover about eight seconds of roughly 11.8 seconds of custom
recording. Metadata also reports eight parser errors and eight missing hierarchy
UUIDs per trace. The custom-buffer completion flag does not make the built-in
trace tail complete. These diagnostics locate observed work and preserve useful
failure limits, but do not identify the cause of the unreproduced slow launches.

All trace records remain separate from comparison aggregates. The
[diagnostic guide](scripts/chromium-diagnostic/README.md) gives bounded commands
and timer scopes. Raw copies and copy-exclusion records are in
`verification/chromium-diagnostic-01` and `-02`.

### Final HDR, verification and resource scope

Both independent-clock modes passed all six HDR checks separately on DP-5:
procedural reference, PNG, AVIF, video, and live video composition at 120/360 scene
targets. The evidence includes FP16 scRGB patch readback, 10-bit output format,
BT.2020/PQ connector metadata, and reused-texture probes before pause and after
resume. All twelve screenshots completed and the original display settings and
HDR metadata were restored exactly. These are 2560×1440 physical-output checks;
the screenshots are SDR and cannot measure panel luminance. Browser bitmap paths
remain SDR; HDR has not been demonstrated for every rendering option.

The published comparison contains **180 captures across 18 studies**, with
**179 valid captures and 140 minutes 40 seconds of valid measured time**, excluding
warmups and diagnostics. One deliberate Glycin lifecycle failure stays visible
and excluded from aggregation. Of valid runs, 174 have verified CPU evidence,
one historical CPU result is unknown and four explicitly disable CPU sampling.
The 121 valid contender captures contain no interval over 50 ms; a 48.61 ms
interval and sustained clusters of missed refresh opportunities still matter.

Across valid measured windows, recorded maxima were 88.625°C CPU, 63°C GPU and
294.306 W GPU power. Minimum free VRAM was 10,373 MiB and available system RAM
78,358 MiB. No valid capture hit a resource guard; 59 record elevated background
activity. These are sampled whole-device/session observations, not exclusive
renderer consumption. Raw records remain local under `verification/`; the
[portable comparison](results/stress/index.html) and
[machine-readable results](results/stress/summary.json) are retained with the code.

### What the switches are testing

The native path is a Rust host, C presenter, LuaJIT/GLSL scene and libmpv media
renderer. This compares complete rendering paths, not the speed of Rust versus
JavaScript as languages.

| Option | Useful property | Cost or limit exposed by this prototype |
| --- | --- | --- |
| Native fixed | Very low CPU, high shader throughput, verified FP16 HDR media/scene composition | Can occupy GPU queues aggressively under contention; a low CPU average does not protect a competing workload |
| Native paced | Same authoring/media/HDR path with bounded outstanding callbacks | Gives up some throughput; a shared span follows its slowest participating output; fullscreen hints do not cover every possible form of occlusion |
| Native independent media clock | Reuses a retained FP16 video texture while the scene follows its own animation clock | Experimental scheduling and libmpv update semantics need timing evidence; greater scene throughput can also mean greater GPU contention |
| Native independent with decoder dropping | Explicit, verified mpv overload policy using the same FP16 pipeline | Did not restore normal-speed 4K360 playback in this NVDEC/H.264 test; enabled policy does not prove actual frame skipping |
| WebKit baseline | Direct HTML/CSS/JavaScript authoring and the original desktop implementation | Much higher CPU in these WebGL scenes; output delivery and adapter identity are incompletely observable through its current host telemetry; SDR path |
| Chromium bitmap | Broad browser scene support and explicit native output feedback | CPU readback, shared-memory writes and texture upload at 4K; variable delivered throughput; bitmap cap of 240; SDR path |
| Chromium DMA-BUF | Could remove the expensive bitmap transfer if interoperability works | Previously produced invalid pixels on this Electron/NVIDIA stack; a failed/black render is not a performance result |

A 3840×2160 BGRA bitmap is 31.64 MiB. Delivering 84 such frames per second already
represents about 2.60 GiB/s of pixel payload before counting additional copies.
The working Chromium path explicitly performs readback, a shared-memory write,
and a texture upload. This explains why eliminating the transfer path is a useful
next experiment; these byte counts are arithmetic, not measured memory bandwidth
or proof of the cause of a particular hitch.

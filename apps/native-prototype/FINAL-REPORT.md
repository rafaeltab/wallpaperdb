# WallpaperDB native stress experiments

Completed 6 September 2026. **180 captures across 18 studies; 179 valid, covering
140 minutes 40 seconds of measured time**, plus warmups and separate diagnostics.

The native approach remains promising. A busy, genuine 3840×2160 shader reached
about 360 presented frames/s while using 4.31% of one logical CPU core in the
capacity screen. That is roughly 0.043 of a core, not 4.31% of the whole 32-thread
machine. It does **not** mean negligible gaming impact: under GPU contention,
the competing workload lost refresh opportunities and one run contained a
48.61 ms interval. The useful decision is about delivered work and frame-time
tails together, rather than the lowest CPU average.

The new independent media clock reached **359.97 scene frames/s with a 4K60
video**, using **6.68–7.01% of one core**, in two capacity controls. The old media
path stayed near 61 fps. Genuine 4K120 video also reached roughly 120 presentations
and 119.8 libmpv media render updates/s, with sampled playback position advancing
at approximately 0.998× normal speed. **Genuine 4K360 video did not succeed**: decoder
activity saturated and video updates collapsed despite a near-360 presentation
counter. These are different outcomes, and both are retained in the report.

Open the [interactive comparison](results/stress/index.html) to filter runs and
inspect frame-time, CPU and resource plots. It works locally without a server.
The [machine-readable results](results/stress/summary.json) preserve source hashes
and evidence limits. Detailed methods, tables, commands and limits are in [STRESS.md](STRESS.md).
Earlier prototype findings remain in [RESULTS.md](RESULTS.md).

## What you can try

The existing prototype is still available. The library's renderer dropdown now
includes three additional alternatives:

- **Native · Compositor-paced Lua / GLSL** waits for compositor frame opportunities
  with a bounded number of outstanding callbacks. It trades some wallpaper
  throughput for less aggressive submission, especially under saturation.
- **Native GPU · independent media clock** lets live scene animation reuse an
  FP16 video texture between media updates. This tests whether a 60 fps video
  can coexist with a 120–360 fps animated scene.
- **Native GPU · independent video with frame dropping** uses the same clocks
  and color pipeline, with explicit permission for mpv to skip video frames
  when decoding falls behind. It is a separate overload experiment.

The **Stress studio** collection contains light, standard, heavy and video-heavy
presets. Native Lua/OpenGL and browser JavaScript/WebGL use the same shader body:
moving objects and lights, layered noise, stars, audio spectrum, pointer response,
and date/time. Genuine 4K60, 4K120 and 4K360 video sources complement the live
scenes. The high-rate files have 960 and 2,880 timestamped frames in eight seconds;
they are not the 60 fps clip played faster or enlarged lower-resolution video.
A separate fixed-input heavy control redraws the same shader workload continuously
for comparison. It is explicitly labelled as a benchmark.

```sh
make native-lab
```

Select a Stress studio item, a renderer, and a frame budget. Commands and asset
generation details are in [STRESS.md](STRESS.md) and the
[high-rate video guide](scripts/high-fps/README.md).

## What the existing comparisons establish

| Path | Strength demonstrated here | Practical limit |
| --- | --- | --- |
| Native fixed | Low CPU and high shader throughput; native image/video/live HDR transport | High-rate GPU submission still interferes with competing graphics work |
| Native paced | Can preserve more contender presentations when the GPU is saturated | Benefit varies; a span can follow its slowest participating output |
| Native independent media clock | Verified 4K360 scene animation with a 4K60 retained FP16 video texture | Cannot overcome saturated video decoding; higher scene throughput consumes more GPU resources |
| Native independent with decoder dropping | Explicit mpv policy, verified at initialization; same working HDR pipeline | Did not recover normal-speed 4K360 video in two paired repeats |
| Baseline GTK / mpvpaper | Cheap retained images and ordinary video | Baseline live HTML/WebGL has a very different, much higher cost |
| WebKit live | Familiar HTML/CSS/JavaScript authoring | These 4K scenes used over one CPU core; delivered output is not observable with the current host |
| Chromium bitmap | Broad browser features with observable native presentation | Substantial copying and CPU use; large run-to-run throughput variation; effective cap 240 |
| Chromium DMA-BUF | A plausible way to avoid bitmap transfers | Invalid pixels on this Electron/NVIDIA setup; not a successful renderer or benchmark result |

At a 120 fps request, the native shader maintained roughly 120 fps in the
repeated DP-2 contention study. At 360, saturation reduced its throughput and
worsened the contender's tail. On the separate physical 360 Hz contender test,
fixed native delivered roughly 359 fps while the contender ranged 333–342 fps;
paced native delivered roughly 353 while the contender ranged 347–350. These
are synthetic workload results, not measured FPS in Potion Craft or another game.

The fixed-input heavy control strengthens the pacing result. Across three
repeats, fixed native presented 248–263 fps while the contender delivered
107–135; paced native presented 240–251 while the contender delivered 143–144.
Disabling periodic CPU/status sampling left similar contention loss. These
controls narrow the interpretation, while the complete graphics pipelines and
active desktop still differ.

For a future app, a moderate frame budget and reliable pause while gaming are
more defensible starting points than always rendering a wallpaper at display
refresh. The prototype keeps the aggressive settings available to explore the
tradeoff.

The original 360 fps video path illustrates why the counters matter. It presented
358.4 frames/s but updated its video texture only 28.2 times/s. The independent
path presented 358.6 but updated media 17.4 times/s and advanced at about 0.56×
normal video speed. Every active 360 video case recorded 100% whole-device decoder
activity, including the preserved background video. A surface can refresh quickly
while its content is stale. Baseline mpvpaper's low CPU and source-FPS metadata do
not prove full-rate playback either.

The decoder-only check completed both source files with their expected frame
counts, at about 206 decoded frames/s in this desktop session. The files are
decodable; normal-speed 360 fps playback failed. Explicit `decoder+vo` dropping
did not improve it in the paired follow-up: both modes remained near 0.56× speed.

Pause stopped the instrumented animation and video work, but browser paths
retained occasional CPU bursts. Baseline bursts recurred about every ten seconds
and involved both the controller and WebKit. Chromium had a large burst in one
child process. Peak sampled 50 ms intervals reached about 94–95% of one core,
despite small means. Contender timing around those bursts stayed within two
refresh periods in the recorded runs. The bursts' underlying cause remains open.

Two isolated Chromium traces localized substantial CPU work in its Browser
process and bitmap transfer stages, but did not reproduce the earlier 2×
throughput variation. Their built-in trace buffers filled before the full custom
recording finished. They are diagnostic evidence, excluded from performance
aggregates, and do not establish the cause of the slow launches.

## Interpretation limits

The PC has an RTX 4080 and Ryzen 9 7950X. Its 360 Hz physical display is
2560×1440; there is no 4K panel. The 4K wallpaper measurements used an owned
3840×2160@360 virtual output. They establish actual 4K rendering and compositor
presentation, not physical 4K360 scanout. Physical contenders ran on DP-2 or the
main DP-5 as recorded in each study. Main-screen contender output was black.

This was an active desktop session. The user's existing mpvpaper video continued
under the cover; other applications remained open. Idle controls, background
process snapshots, input observations and build/source hashes are retained.
GPU utilization, power and VRAM are whole-device values. GPU elapsed queries have
different scopes across paths and are not exclusive per-renderer execution cost.
CPU is sampled at 20 Hz; actual presentation intervals retain much finer timing.
Wallpaper CPU includes the controller and observed renderer processes. It
excludes the separately recorded compositor, profiler, contender and existing
background applications.

Both new independent-clock modes passed all six HDR checks separately: image,
video, procedural content and retained live-video composition at 120/360 scene
targets. Native FP16 composition and the compositor's 10-bit PQ output were
checked numerically. An SDR screenshot cannot
measure the panel's HDR luminance. The browser bitmap paths remain SDR, and the
Chromium shared-texture failure means HDR has not been demonstrated for every
rendering option.

## Lessons for a separate production app

Rust remains a good fit for state, asset management, scheduling and process
ownership. This prototype's C presenter was a convenient way to exercise the
installed Wayland/EGL, libmpv and LuaJIT interfaces; the measurements compare
complete pipelines, not Rust versus JavaScript language speed. Lua/GLSL is a
useful programmable lightweight path, while browser scenes buy authoring breadth
at a substantial cost on this stack.

The reusable ideas are the assignment/group model, live input contract,
independent media and scene clocks, retained textures, explicit color pipeline,
and capability/evidence reporting. Desktop attachment, swapchain presentation,
GPU sharing and HDR negotiation need platform adapters. HTML/JavaScript, Lua,
libmpv and Rust can inform Windows or macOS versions, but this Wayland/EGL backend
is not a tested cross-platform implementation. A Rust/wgpu backend is a worthwhile
separate experiment, not a portability result established here.

Production work would need resource budgets and pause policy, robust scheduling
across mixed refresh rates, hardware-decoder and driver coverage, platform-native
HDR tests, untrusted-bundle isolation, bounded asset loading, crash recovery,
packaging and backend integration. Most importantly, it needs repeated tests
alongside real games and long-running sessions. This code remains a disposable
laboratory; its findings and interfaces are the intended output.

Those budgets must cover all monitor groups and decoders. A global gaming-pause
option matters when another monitor remains visible. Retaining textures makes
resume cheap but retains memory; a longer suspension may need to release decoder
buffers. Avoid periodic corrective seeks as a normal synchronization strategy:
sharing one timeline and decoder across a group is a better starting point.

## Verification and saved state

The current native checks passed: 13 Rust tests, six runtime JavaScript tests,
125 Python tests, two C suites, formatting and Clippy. The new drop variant passed
18 actual desktop checks; the library UI and twelve comparison-page browser
checks also passed. [Verification details](results/stress/verification.json)
include the twelve new HDR results. Full-repository `make ci` and `make format`
could not complete because the Node workspace dependencies, including
Vitest/Turbo, are absent.

The comparison retains one deliberately invalid image-loader lifecycle capture,
one historical CPU result with insufficient evidence, and four valid controls
with CPU sampling disabled. Unsupported CPU statistics stay unavailable. An
independent review checked the exclusions, all 26 raw report hashes, the fixed
uniform evidence and the new video policy records.

Valid-window maxima were **88.6°C CPU, 63°C GPU and 294.3 W GPU power**. At least
10.1 GiB VRAM and 76.5 GiB system RAM remained available in recorded samples.
No valid capture hit a resource guard. These are sampled whole-device values.

The original wallpaper assignments, main workspace and display color settings
were restored. All temporary benchmark outputs were removed. The existing
background video was preserved. The OLED cover and sleep inhibitor remain only
for final saving, then are released before the requested PC shutdown. Raw evidence
is saved under `apps/native-prototype/verification/`; the portable report, plots,
screenshots and implementation are in the repository. No changes were pushed.

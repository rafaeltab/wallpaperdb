# Renderer laboratory results

Captured on Manjaro/Hyprland, September 5–6, 2026. These are results from this workstation and these workloads, not a guarantee about game FPS or other drivers.

## What works

The original prototype remains selectable. The laboratory adds native Lua/GLSL and Chromium HTML/JavaScript, with independent assignments and a single simulation/producer/decoder for each spanning group. Twenty-three real desktop checks passed on DP-2 and two temporary virtual outputs: visible stationary images, changing video/live content, keyboard signals, pause/resume, system-output audio, pointer data, shared spans plus independent groups, fullscreen suspension, retained-image reveal, reconnects, and producer disconnects. Both working alternatives ran the original image/video compositions as well as Prism. [Final desktop check](verification/lab-1788650065/report.json).

The real library UI passed its browser automation, including applying both alternatives, HDR option gating, the experimental warning, keyboard controls, and desktop/narrow layouts. Twelve Rust tests and four JavaScript runtime tests passed, as did Rust formatting and clippy. The interactive report's run selector, time-window controls, plots and metrics table also passed a real browser check. Repository-wide `make ci` and `make format` could not run: this checkout has no installed `vitest` or `turbo` from the Node workspace. Native checks and formatting are independent of those missing dependencies.

Start with `make native-lab`; [LAB.md](LAB.md) contains the switches, authoring examples, HDR preview and profiling commands.

## HDR: content and signal, not a screenshot claim

| Rendering path | Live reference | HDR still image | HDR video |
| --- | --- | --- | --- |
| Native Lua/OpenGL + libmpv | Pass | Pass: 16-bit PNG and 10-bit AVIF | Pass: 10-bit HEVC, NVDEC |
| Chromium accelerated DMA-BUF | Failed import | Failed import | Failed import |
| Chromium bitmap transfer | SDR only | SDR only | SDR only |
| Original WebKit / GTK / mpvpaper | SDR path | SDR path | SDR path |

The native tests verified all eight reference patches, from 0.1 to 800 cd/m², in actual rendered FP16 content. DP-5 accepted an scRGB surface, presented it, and scanned out a ten-bit format with BT2020_RGB and PQ HDR metadata. All saved display settings checked by the verifier and the original DRM color properties were restored. Machine-readable evidence is in [results/hdr.json](results/hdr.json); complete local traces and screenshots are under [the final HDR capture](verification/hdr-1788650213/report.json).

This verifies HDR content handling and output signaling. It does not measure the panel's physical luminance, wide-gamut accuracy, or its tone mapping of the 800-nit patch. The SDR screenshots clip highlights and serve only as appearance evidence.

Electron 42.7.0 / Chromium 148 produced black accelerated SDR buffers with Vulkan enabled; the default GL route instead failed to initialize its capture surface. FP16 capture reached the import boundary but failed when the presenter tried to sample the imported texture as `GL_TEXTURE_2D`. These failures remain exposed under `chromium-dmabuf`; a received texture is not counted as a successful HDR path. The ordinary bitmap route renders correctly but intentionally rejects HDR. Related failures are tracked in [Electron issue 53271](https://github.com/electron/electron/issues/53271); that is supporting context, not proof that every machine or Chromium embedding fails.

## Performance method

The test machine has a Ryzen 9 7950X, RTX 4080 with NVIDIA 610.43.03, and Hyprland 0.56.0. DP-2 is 1920×1080 at 144 Hz and scans out through the integrated AMD GPU. The alternative presenters and the synthetic contender render on NVIDIA. DP-5 is an Alienware AW2725DF, 2560×1440 at approximately 360 Hz, used for HDR verification.

The contender repeats the same 1280×720 shader workload a fixed number of times per frame, targeting 144 fps. At 600 passes its typical GPU command span is approximately 4.4 ms before competing desktop work. It is a graphics contention probe, not a game simulation. The wallpaper request is 30 fps. Existing unrelated backgrounds and applications remain running; all other wallpapers owned by this prototype and its library UI are removed during measurement and assignments restored afterward. Clocks are observed rather than locked.

The main comparison uses three 120-second runs per condition, each after 20 seconds of warmup, alternating forward/reverse condition order. It measures actual compositor presentation timestamps and refresh sequences, asynchronous GPU queries, CPU runtime and resource telemetry. CPU percentages refer to one core, summed over the process tree. Submitted-frame elapsed time includes waits and is distinct from CPU runtime. WebKit exposes animation callback cadence but not equivalent wallpaper presentation feedback; both are labelled separately. Original CPU copying/compatibility choices remain in effect.

### Recorder control

Four 60-second runs used the same contender in off/on/on/off order, each after 20 seconds of warmup. “Off” disables CPU/NVML/status sampling during measurement; buffered frame recording remains active.

| Control | Presented updates/s | Gaps of ≥2 refreshes/min | Gaps of ≥3 refreshes/min | p99 / p99.9 interval | Worst interval |
| --- | ---: | ---: | ---: | ---: | ---: |
| Off 1 | 143.53 | 28 | 0 | 6.946 / 13.890 ms | 13.890 ms |
| On 1 | 143.53 | 28 | 0 | 6.946 / 13.890 ms | 13.890 ms |
| On 2 | 143.43 | 33 | 1 | 6.946 / 13.890 ms | 20.834 ms |
| Off 2 | 142.98 | 61 | 0 | 6.946 / 13.890 ms | 13.890 ms |

The recorder averaged 0.603% and 0.614% of one CPU core, with p99 2.545% and 2.570%. The first pair had identical cadence; the second was slightly better with sampling. That apparent improvement comes from the noisier final off run and is not a benefit of recording. These controls show no consistent added cadence penalty, while the one three-refresh interval means a rare recorder-induced hitch cannot be excluded.

Control traces: [Off 1](verification/profile-1788645720/report.html), [On 1](verification/profile-1788645800/report.html), [On 2](verification/profile-1788645881/report.html), [Off 2](verification/profile-1788645961/report.html).

### Sustained comparisons

All twelve main runs were valid. Values below are the median of three run-level measurements; brackets show the smallest and largest run. CPU “mean” is weighted by the actual sampling interval. Frames are not treated as independent benchmark repetitions.

| Prism, requested 30 fps | Wallpaper CPU mean / p99, % of one core | Actual wallpaper updates/s | Contender updates/s | Contender ≥2-refresh gaps/min | Contender ≥3-refresh gaps/min |
| --- | ---: | ---: | ---: | ---: | ---: |
| No prototype wallpaper | 0.19 / 1.99 | — | 142.72 [142.69–142.81] | 72 [69.5–73] | 3.5 [1.5–3.5] |
| Original WebKit | 32.03 / 56.59 | Unavailable; 21.64 callbacks/s | 133.15 [132.32–137.41] | 601.5 [387–660] | 39.5 [8.5–47] |
| Native Lua/GLSL | 0.92 / 3.48 | 30.00–30.01 | 143.07 [141.42–143.40] | 51.5 [33–133] | 4 [2.5–20.5] |
| Chromium bitmap copy | 50.00 / 88.22 | 21.29–24.74 | 141.43 [140.92–141.74] | 138.5 [131–169.5] | 14.5 [4–15] |

Native is the strongest direction from this comparison: it consistently sustains the requested wallpaper cadence with little CPU work, and both alternatives reduce the contender's two-refresh gaps relative to WebKit in all three repetitions. Chromium's copy path is useful for authoring experiments, but its 30 JavaScript callbacks/s conceal much lower delivered cadence. Its wallpaper's p99 presentation interval is 69.45–104.17 ms.

This does **not** establish hitch-free behavior. In repetition 2 the native contender had 20.5 three-or-more-refresh gaps/min versus idle's 1.5 and WebKit's 8.5. Native's contender change versus the corresponding idle run was +0.34, −1.39 and +0.71 updates/s. WebKit was consistently worse than idle (−10.41, −5.40, −9.54); Chromium copy was also consistently worse (−1.29, −1.07, −1.77). A median-only comparison would hide the native outlier.

The contender's p99/p99.9 interval was 6.95/13.89 ms for all idle runs, 13.89/17.45–20.84 ms with WebKit, 6.95–13.89/13.89–20.83 ms with native, and 13.89/13.89–20.83 ms with Chromium. None exceeded 50 ms; the worst was approximately 27.78 ms, which still spans four refreshes at 144 Hz. Misses clustered irregularly, including in idle runs. An exploratory approximately three-second peak appeared in two Chromium runs but did not repeat in the third; the evidence does not identify a stable periodic cause.

Inspect the [interactive main capture](verification/profile-1788646042/report.html) to align frame intervals with resource samples. [results/performance.json](results/performance.json) preserves all per-run summaries, paired deltas, cluster definitions, recorder controls, provenance hashes and limitations. Raw traces and a snapshot of the profiled source remain in the ignored capture directory.

### Video/audio and paused scenes

Afterglow combines a looping video, date/time graphics, pointer response, keyboard signals and playback-audio input. One 90-second run per renderer used the same binaries, 20-second warmup and contender. These are supplemental screening runs, with no matched idle or audio-off control.

| Afterglow with audio enabled | Wallpaper CPU mean / p99, % of one core | Actual wallpaper updates/s | Contender updates/s | Contender ≥2 / ≥3-refresh gaps/min |
| --- | ---: | ---: | ---: | ---: |
| Original WebKit | 104.63 / 124.92 | Unavailable; 23.28 callbacks/s | 137.83 | 324.67 / 44 |
| Native Lua/GLSL | 3.22 / 6.27 | 30.00 | 142.94 | 57.33 / 6 |
| Chromium bitmap copy | 55.04 / 90.52 | 25.16 | 140.54 | 201.33 / 6 |

Native reported NVDEC in every telemetry sample. Both browsers reported an advancing, unpaused video with no playback errors. Audio data was available and RMS values changed throughout the samples. This proves that the scene's media/input paths were active; global decoder utilization cannot prove which decoder a browser used. The native wallpaper's p99 presentation interval was 41.67 ms, and Chromium's was 69.45 ms. Inspect the [video/audio capture](verification/profile-1788648028/report.html) and the separate screening section of [the durable summary](results/performance.json).

Each paused renderer then ran for 60 seconds after 20 seconds of warmup, with Prism and audio disabled:

| Paused Prism | Wallpaper CPU mean / p99, % of one core | Contender updates/s | Contender ≥2 / ≥3-refresh gaps/min |
| --- | ---: | ---: | ---: |
| Original WebKit | 0.43 / 2.82 | 143.15 | 47 / 3 |
| Native Lua/GLSL | 0.38 / 2.80 | 142.05 | 113 / 2 |
| Chromium bitmap copy | 2.27 / 5.49 | 142.93 | 64 / 0 |

All scene frame counters remained fixed. Native and Chromium produced zero wallpaper presentation events during the measured minute; WebKit's scene counter also stopped. Browser callback timing retained from before pausing is deliberately excluded. Chromium still has measurable residual CPU, including a 23.39% maximum over one approximately 50 ms sample. Pausing stops rendering, but does not make the resident browser and host free. These single runs have no matched idle control and do not show that every desktop hitch disappears. [Paused capture](verification/profile-1788648393/report.html).

Together these 22 captures contain 35.5 measured minutes, plus warmup. All used the same renderer binaries and scene assets for their respective workloads. Subsequent changes fix the Wayland event loop, display lifecycle, error reporting, startup preflight and opt-in tracing; the profiled source snapshot and hashes preserve that distinction. The final executable receives separate desktop/HDR regression checks and a separately labelled performance screening.

### Final-build screening

Three additional 60-second runs, each after 20 seconds of warmup, checked the final executable with the same Prism workload and 600-pass contender. All were valid. This is a single serial screening, not a replacement for the repeated comparison.

| Final build | Wallpaper CPU mean / p99, % of one core | Actual wallpaper updates/s | Contender updates/s | Contender ≥2 / ≥3-refresh gaps/min |
| --- | ---: | ---: | ---: | ---: |
| No prototype wallpaper | 0.21 / 2.33 | — | 143.82 | 11 / 0 |
| Native Lua/GLSL | 1.24 / 4.27 | 30.00 | 139.25 | 285 / 0 |
| Chromium bitmap copy | 54.55 / 95.95 | 21.18 | 143.98 | 0 / 0 |

The final native run has **worse ordinary contender cadence** than both this idle run and the historical native runs. Its wallpaper's own p99 interval is 41.67 ms. Chromium has better contender cadence here, while still showing 104.17 ms p99 intervals in the wallpaper itself. None of these one-minute contender traces contains a three-refresh interval. They cannot be described as preserving the historical relative hitch behavior. The helper update also changes the contender's event loop, and compositor CPU/background activity varied. This is a regression signal to repeat, rather than proof of a renderer-specific cause or a near-idle gaming guarantee.

The native path remains the most compelling experiment for low CPU cost, a reliable 30-fps wallpaper, and working HDR. It is not established as the best choice for game frame pacing. The contrast with Chromium is exactly why both the wallpaper and a competing workload are measured. Inspect the [final-build capture](verification/profile-1788650320/report.html) and its separate section in [the durable summary](results/performance.json). All 25 captures together contain 38.5 measured minutes, plus warmup.

### Limits of this comparison

This is an end-to-end comparison at equal configured frame rates. The scenes have separate implementations and deliver different amounts of visible work. It is not an isolated comparison of language or graphics API efficiency. Three serial repetitions with one reversed ordering cannot establish statistical equivalence or performance in a real game. HDR, a saturated game workload, many concurrent wallpaper outputs, and AMD GPU time are outside these sustained measurements.

Resource sampling averaged 0.61%, 0.87%, 0.68% and 1.23% of one core in idle, WebKit, native and Chromium runs respectively. The recorder control covers the idle case. Frozen process membership includes exited threads but can miss short-lived helper processes created after warmup. A 20 Hz CPU sample and coarse NVML averages cannot explain the cause of an individual seven-millisecond scheduling miss. Actual presentation timing remains the direct evidence for cadence.

## Lessons from the experiments

* HDR is an entire content/presentation/output path. A float framebuffer alone was insufficient: mpv's default destination-depth assumption added eight-bit dithering to the intermediate PQ image. Disabling that dithering substantially improved the known patch values.
* A portable execution language does not make desktop presentation portable. HTML/JS, Lua and libmpv remain useful building pieces; layer shell, GPU buffer transport, color descriptions and desktop placement are platform boundaries that still need separate implementations.
* A browser's successful animation loop does not prove successful desktop pixels. Chromium produced callbacks and transferable buffers while the sampled result was black. Pixel probes and presentation feedback caught this.
* One shared producer for a spanning group works. It avoids independently timed browser instances, duplicate decoders and periodic video-seek synchronization within that group. Full-canvas FP16 textures still have a memory cost, including gaps in the monitor arrangement.
* Measurement code can create the problem being investigated. Relative frame scheduling made the original contender drift to about 110 presentations/s. Absolute deadlines restored approximately 144/s under moderate load. A periodic whole-system process scan also introduced recorder CPU bursts; preparing process clocks once removed that scan from the measured interval.
* Display lifecycle must include the whole shared player. Removing a middle output may leave canvas bounds unchanged, so geometry alone cannot determine whether to rebuild a spanning renderer. Fullscreen/disconnect checks also exposed intermittent stale helper telemetry. Its poll-then-blocking-dispatch pattern could race with EGL's Wayland reader; the final helper uses the documented prepare/read/cancel sequence. Stack attachment was blocked by the host's ptrace policy, so the diagnosis rests on captured compositor/host state, the unsafe API pattern, and subsequent passing regression checks. A closed producer socket now exits explicitly instead of repeatedly waking the poll loop. [Wayland client API](https://wayland.freedesktop.org/docs/html/apb.html).
* Low CPU alone does not establish predictable game impact. The useful comparison is the competing workload's tail behavior, achieved wallpaper cadence, and repeat-to-repeat variation. The native renderer's own small GPU timer also excludes asynchronous decoding, while the Chromium presenter's timer excludes browser production and import work.

Rust continues to own library state, CLI/UI control and process lifetime. The native experiment deliberately uses a small C helper because EGL, Wayland protocols, libmpv and the installed LuaJIT already expose C interfaces. This is an expedient prototype boundary, not a recommendation to turn this code into the production application. The working shared-group and color pipeline can inform a later Rust/wgpu or other backend experiment, but that port has not been tested here.

# CS2 Bench prototype — final report

8 September 2026. This report covers the new real-game Bench feature. The earlier
[renderer stress report](FINAL-REPORT.md) remains separate.

The **Bench button works in the existing wallpaper library**. It can prepare a
local CS2 replay, warm it, run matched controls and wallpaper trials, show individual
game frame-time and resource plots, and restore the desktop. The most useful new
finding is that the native renderer retained a substantially better combination of
wallpaper throughput and game performance in the shared heavy scene.

[Open the offline interactive comparisons](results/game-bench/index.html).
[Usage and implementation boundaries](GAME-BENCH.md).
The interactive report needs neither the wallpaper daemon nor an internet connection.

## Repeated renderer comparison

All three used the same cached Dust II replay, fixed heavy wallpaper scene on DP-2,
120 wallpaper FPS request, prototype High game settings, a 360 FPS game limit,
and the active wallpaper policy. CS2 rendered at 1600×900 on DP-5. Each renderer
received three alternating control/wallpaper pairs, after an excluded warmup.
These captures are separate from the older 4K synthetic contender experiments.
The wallpaper deliberately redraws one fixed heavy shader frame, with fixed phase
and pointer position, silent audio and no input signals or video. This controls
scene complexity; it does not establish costs for arbitrary changing live content.

| Renderer | Reported wallpaper FPS | Game FPS, control → wallpaper¹ | Median paired FPS change | Median paired p99 change | Worst wallpaper-run frame |
|---|---:|---:|---:|---:|---:|
| Native Lua / OpenGL | 120 | 266.5 → 253.6 | −5.2% | +0.44 ms | 7.44 ms |
| Chromium bitmap transport | 82 | 267.3 → 215.3 | −20.1% | +1.63 ms | 9.45 ms |
| WebKit baseline | 62 | 269.9 → 219.7 | −17.5% | +1.30 ms | 8.80 ms |

¹ Each FPS value is the median of its three runs; the percentage is the median of
the three paired changes, so it is not calculated from the two displayed medians.

The native path delivered the requested wallpaper rate while producing the smallest
measured game penalty in this workload. Chromium's bitmap transport delivered more
wallpaper frames than WebKit, at a somewhat larger game cost. Neither browser path
reached the same delivered rate as native, so this is a comparison of their actual
behavior at the same requested budget, not a claim of equal throughput.

Whole-GPU utilization medians were approximately 40% in controls and 48%, 51%,
and 49.5% with native, Chromium, and WebKit respectively. Those whole-device samples
do not identify which renderer component caused the slowdown. CS2 process CPU was
roughly 4.3–4.4 cores in these captures; this is not wallpaper CPU attribution.

There were **no frames over 50 ms** in the repeated renderer captures. The observed
effect was elevated frame times, including worse p99, rather than large occasional
hitches. This does not prove freedom from recurring stutters: each measured run
lasted only about 9–12 real seconds, despite selecting 40 replay seconds. The full
frame traces and spike-preserving plots are retained so the averages cannot hide
the observed tails.

## Other behavior exercised

The initial automatic Prism comparison at a 120 FPS game limit produced about
119.2 game FPS in both conditions. Its roughly +0.1% average difference is noise-level
functional evidence, not a performance benefit.

The validation matrix covers retained 4K images, ordinary 4K video, fullscreen video
pause, a partially visible spanning producer, and the independent media-clock
variants. Individual outcomes and their evidence IDs are recorded in the validation
record [beside the interactive report](results/game-bench/VALIDATION.md). Capped, single-pair cases demonstrate the
workflow; they are not a second renderer ranking.

The UI offers current/Low/High graphics requests, 120/240/360/uncapped game limits,
20/40 replay-second intervals, one or three pairs, a separate game display, and the
existing wallpaper renderer/output/span settings. Results include average FPS,
1% and 0.1% lows, percentile tails, worst frame, slow-frame clusters, threshold
counts, actual capture duration, resource plots, raw links and JSON export. The
latest successful comparison reloads after a prototype restart.

## Lessons from making the harness real

**A compatible replay is a game-adapter problem.** An older downloaded demo was
incompatible with the installed build. Local recording then exposed a Source2
baseline error when a newly planted bomb appeared. The working local recipe disables
bomb spawning and validates playback before caching the recording. Recording at
60 FPS with the other prototype surfaces cleared avoided the unnecessary setup
load that had tripped the existing conservative CPU guard. No CPU power or cooling
settings were changed.

**The game's aggregate summary is insufficient.** Source2 can exclude a pause from
its aggregate benchmark timing. The native per-frame CSV retains application swap
intervals; the parser preserves repeated-tick stalls and checks exact selected tick
coverage. Old setup/seek failures and incomplete traces are retained as failures,
not folded into successful comparisons.

**Requested settings need observations.** This installation's saved resolution is
1600×900. A request for 2560×1440 was clamped to 1920×1080, so Bench defaults to
the saved game resolution and rejects an explicit mismatch. The compositor window
can be fullscreen while the game backbuffer is smaller; this is not a physical
1440p game benchmark. Low and High use the current prefixed video-config keys.
Actual render-target logs distinguish no MSAA from 4× MSAA even though the engine's
legacy CPU/GPU level summary stays unchanged. The submitted config and observed
subset are kept separately. Not every graphics variable or VSync/cap setting is
independently verified.

**Fullscreen policy must be measured.** Allowing foreground focus to move to the
library or browser is compatible with the test; hiding the game is not. The harness
checks visibility, output and workspace. Source2 can undo the initial fullscreen
state during startup, so bounded adjustments happen in excluded setup time; any
adjustment overlapping the measured segment invalidates the run. Paused flags alone
are insufficient: stopped frame/playback counters are checked too. A spanning
native producer must continue when one of its outputs remains visible.

**Resource timestamps need their own clocks.** CPU readings use their actual
observation time. GPU samples are aligned using a coarse bridge from the buffered
CSV's observed write times. They can illustrate broad trends, but cannot identify
the cause of one millisecond-scale hitch. The native collector's own overhead was
not isolated.

## Which choices are worth carrying forward?

Native Lua/GLSL remains the strongest performance direction demonstrated by this
scene. It gives explicit frame scheduling and a small rendering path, but requires
a separate authoring model and platform-specific presentation work.

Chromium remains useful for web authoring and existing browser content. Its tested
bitmap-copy path imposes a meaningful game cost here; that cost should be visible
to creators. The prior DMA-BUF path remains disabled because it failed pixel
validation. It cannot be presented as a faster successful option.

WebKit keeps the current GTK integration simple and supports ordinary HTML/JS.
Its lower delivered wallpaper rate and measured game cost mean it should not be
assumed lightweight merely because it is embedded. These captures do not isolate
all the causes of either browser's overhead.

The useful architectural boundary is the **job and evidence contract**: the HTML
UI submits a bounded request; Rust owns wallpaper assignment/restoration; a game
adapter owns replay, settings, capture and process cleanup. Frame analysis and
portable results are independent of the desktop. Keep those contracts, workload
fixtures and measurement lessons. This implementation remains deliberately disposable.

Windows could reuse the request/result schema, UI, analysis and probably the
Source2 collector/parser—the tested game executable already runs under Proton.
Window control, process accounting/termination, sleep inhibition and discovery
still need native Windows implementations. Native Linux launch requires separate
verification. macOS needs its own desktop adapter and an appropriate available
game/collector; there is no macOS runtime proof here. GTK/Wayland layer-shell,
EGL/color-management negotiation and DMA-BUF are not portable wallpaper attachment
or HDR implementations.

For a production successor, the highest-value next steps are longer real-time game
captures, collector-overhead controls, repeatable action-heavy scenes, explicit
effective-setting verification, and independently tested recovery after crashes.
Add per-platform collectors and visibility/power adapters, job/history management,
resource budgets, content permissions and packaging as separate concerns. This
prototype does not establish anti-cheat compatibility, live multiplayer performance,
HDR game benchmarking, mobile support or a production security boundary.

## Validation and unattended operation

All native checks passed: 13 Rust tests, 6 JavaScript runtime tests, 149 Python
tests (including 24 Bench tests), both C pacing/media test programs, Clippy and the
release build. The real local UI harness exercised ten completed comparisons,
chart selections, responsive layout, cancellation/restoration and persistent results.
A graceful host stop while CS2 was visibly fullscreen also restored successfully.
See the [complete validation record](results/game-bench/VALIDATION.md). Portable exports reparse the raw
CS2 CSVs and verify saved statistics before generating the offline report. The
repository-wide Node checks remain blocked by missing workspace dependencies;
they must not be represented as passing native feature validation.

The unattended session used a finite registered idle/sleep inhibitor. Hypridle's
configuration honors that mechanism; its documented default is
[ignore_systemd_inhibit = false](https://wiki.hypr.land/Hypr-Ecosystem/hypridle/).
DP-5 was covered with black between bounded tests, verified with an all-black
screenshot after moving the pointer off the OLED. The cover was removed for the
game comparisons. Monitor modes, layout and power state were left unchanged.

The desktop and game settings are restored before the final shutdown request.
The final validation record and shutdown receipt are saved separately so the report
does not claim to have observed its own machine powering off.

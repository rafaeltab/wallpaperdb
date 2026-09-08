# Real-game Bench prototype

Question: can a button in the existing wallpaper library run a repeatable real-game
scene, compare its individual frame times with and without the selected wallpaper,
and restore the desktop afterward?

This is disposable code alongside the [renderer laboratory](LAB.md). It runs real
CS2; it does not substitute a synthetic game. The first adapter is for Manjaro,
Hyprland, Steam and NVIDIA NVML. The tested installation is Windows CS2 under
GE-Proton. Native Linux discovery is implemented but has not been exercised.
Cyberpunk remains a possible next adapter; it is not implemented here.

## Try it

From the repository root:

    make native-lab

Select an installed wallpaper, renderer, output(s), and independent/spanning layout.
Choose **Bench** in the inspector, then the game display, graphics preset, game FPS
limit, and recording mode. **Start comparison** opens the separate results view.
**Benchmarks** in the sidebar opens the history of runs, including interrupted and
failed attempts. Each card shows the wallpaper, game and options. Open a run and
choose **View parameters** to inspect its settings. The native library window stays
on its existing display and workspace. Choosing that same game display shows a
warning that the game may hide the library.

Open a run in **Benchmarks** and choose **Rename** to give it a recognizable name.
Names persist across restarts; the original wallpaper and recording parameters
remain available. **Delete** asks for confirmation before permanently removing that
run's results, raw recordings, logs and recovery backups. Installed wallpapers and
other benchmarks are kept. A running or restoring benchmark can be renamed, but
must finish stopping or cancelling before it can be deleted.

**Automatic replay comparison** runs the configured replay interval and pair count.
**Continuous gameplay · stop manually** opens one offline Dust II bot game. Choose
**Start control recording** when ready, then **Record wallpaper benchmark →** to
switch phases without restarting the game. **Stop and save** finishes the recording.
Control and wallpaper durations are independent. Stopping with only a control phase
saves it without inventing a comparison. Manual gameplay differences are descriptive;
the workload is not matched between phases.

The results view shows **Recording control benchmark** or **Recording wallpaper
benchmark**, a capture timer in manual mode, and graphs that update about once per
second. **Cancel and restore** remains available. In replay mode, Stop and save keeps
completed trials; an interrupted trial remains provisional and cannot contribute to
the validated comparison. Closing the results panel leaves the run active. Closing
the native library window requires stopping or cancelling the active run first.

Uncheck **CPU temperature check** in the Bench panel to disable its 96°C / three-second
cutoff for that comparison. The checkbox starts enabled. Your choice is included
in the result and exported JSON; CPU temperature readings are still collected.
GPU temperature, free RAM/VRAM and resource freshness checks stay active. Replay
jobs retain their time limits; manual recordings have no fixed capture duration.

The game display can differ from the wallpaper displays. **Keep playing** measures
active wallpaper interference. **Normal policy** measures the existing fullscreen
pause behavior; a shared spanning producer continues if another selected display
is still visible. The result validates the observed surface and producer policy.

In automatic mode, the first run records local bots on Dust II using the installed game build. It
records at a lower rendering budget, then restores the chosen benchmark settings.
Bomb spawning is disabled because this CS2 build's mid-session recordings failed
to replay a newly planted bomb. Recordings are cached by build and SHA-256, and
only marked reusable after a successful warmup. Advanced options accept a local
compatible .dem file instead; a private copy is used throughout the comparison.

Close any already-running CS2 instance first. Bench never takes over that process.
Keep the game visible and avoid other heavy work during capture. You can use the
library's Cancel control on a secondary display: the replay is allowed to render
without foreground focus. Do not move it to a hidden workspace.

**Use the saved game resolution** is the default. On the tested Proton installation,
CS2 accepted 1600×900 but clamped a 2560×1440 request to 1920×1080. Automatic replay mode records actual engine dimensions and rejects a mismatch.
Manual mode records the requested dimensions without claiming independent engine
verification. Bench never changes monitor modes.
Low and High are prototype setting bundles, not a claim to reproduce every Valve
preset. The exact submitted config and engine-reported subset are retained.

## Read the result

- The table shows average FPS, 1% low, p99, worst frame, >50 ms frames, and actual
  capture duration. Detailed metadata also contains p95/p99.9, 0.1% low sample
  count, additional thresholds, slow-frame clusters and their longest length.
- Frame charts retain each bucket's maximum; isolated spikes cannot disappear
  into an average. Hover for the minimum, maximum and number of underlying frames.
  Align comparisons by replay position or elapsed capture time.
- Resource plots show the whole NVIDIA device, or CS2 process CPU as percent of
  one core. CPU observations retain their own timestamps.
- Three pairs run A/B, B/A, A/B after one excluded warmup. Summary differences are
  medians of paired differences; one quick pair does not establish a small effect.
- **Export result JSON** exports inspectable plots, summaries and metadata. All
  saved runs can be reopened from Benchmarks after restarting the prototype.

In automatic mode, Source2's native individual-frame CSV supplies application swap intervals. Bench
retains duplicate ticks and real pauses, validates timestamp deltas and complete
scene coverage, and excludes loading/setup ticks. The engine's aggregate benchmark
summary can omit a real pause and is not used as the frame-time source.

Timedemo renders approximately one frame per replay tick. It accelerates the world:
40 replay seconds at 120 FPS produces roughly 21.5 actual capture seconds; at
360 FPS it is roughly 7 seconds. Short captures are poor evidence for rare hitches.
These measurements are not physical scanout, input latency, or compositor misses.
The GPU clock bridge is estimated from buffered CSV writes and is suitable for
coarse trends, not identifying the cause of an individual hitch. Collector overhead
has not been isolated. Submitted settings are distinguished from engine observations.

Manual mode requires MangoHud (tested with 0.8.4). It reads a continuously written
per-frame Vulkan CSV and copies selected ranges into independent control/wallpaper
files. Loading and phase transitions are excluded. The elapsed clock and frame
coverage are validated before accepting a phase. The HUD is transparent and outside
the viewport: in this version `no_display` prevents autostart logging, and Proton's
multiple Vulkan instances caused the optional control socket to collide. No global
MangoHud configuration is changed. These behaviors are visible in upstream's
[frame update code](https://github.com/flightlessmango/MangoHud/blob/v0.8.4/src/overlay.cpp)
and [logger](https://github.com/flightlessmango/MangoHud/blob/v0.8.4/src/logging.cpp).

Long recordings retain at most 1200 frame buckets and 1200 resource points per phase;
frame buckets preserve their minimum and maximum as the timeline grows. Exact frame
values use eight bytes per frame in the worker. Live percentile bins have 1 µs
resolution; saved statistics are recalculated from exact values. Raw CSVs and
MangoHud's own buffer grow with the recording; this is not a constant-memory recorder.
The portable HTML report exporter remains specific to completed replay comparisons.

## Ownership and artifacts

Each private job directory under
~/.local/share/wallpaperdb-native-prototype/benchmarks/game-* contains:

- raw frame CSVs, console output, launch/config evidence, resource observations,
  wallpaper state and a warmup screenshot;
- partial and final analysis JSON, job progress and final desktop status;
- original library and game-settings backups plus desktop/process receipts.

Game-setting backups can contain personal settings. Export the comparison or the
portable results described in the report; do not publish a complete private job
directory. Jobs are retained for inspection and are not automatically pruned.

Rust owns temporary wallpaper assignments and restores the saved library after the
worker exits. Python owns the game, settings, workspace, and external mpvpaper
process leases. External mpvpaper is frozen in both conditions; its retained
textures remain. Other background applications are not stopped. The job acquires
a verified, finite idle/sleep inhibitor before freezing the video.

Replay jobs have a 15-minute limit and individual scene deadlines. Manual sessions
run until stopped, with renewable 15-minute sleep-inhibitor leases. Temperature,
free-VRAM, free-RAM, telemetry freshness and manual capture disk-space guards remain
active. A kernel journal watcher also stops a run on GPU faults, including faults
from the AMD device used by the compositor. After a fault, prototype rendering and
Bench remain paused for that graphics session; original assignments stay in the job
backup instead of being rendered again. The CPU temperature checkbox does not
disable this graphics-fault check. Cancellation and graceful host exit attempt every
cleanup independently. Owned game processes and external players use pidfd identity
handles. Forced process kills or a power failure are not crash-safe recovery;
durable backups are retained, but there is no production recovery service.

Chromium DMA-BUF remains unavailable for Bench because it failed earlier pixel
validation. Replay validation rejects missing frames, renderer errors, unverified
pause/playback state, incomplete game traces and restoration failures. Manual CSV
validation cannot establish that the game is visibly rendering correctly: the
DP-2 tests below passed trace validation but had black game captures, and were
subsequently marked invalid after visual inspection.

## Developer checks

    make native-game-bench ARGS='--discover'
    make native-game-bench-test
    make native-game-bench-ui-test
    make native-game-bench-ui-test ARGS='--temperature-option'

Rename/delete checks use temporary filesystem jobs and an isolated UI fixture;
they do not connect to the real desktop library, change existing recordings, or
launch a game. The UI test uses headless Chromium with the GPU disabled:

    make native-test
    make native-game-bench-ui-test ARGS='--history-actions'

The UI harness connects to the actual running local library. To exercise the game:

    make native-game-bench-ui-test ARGS='--run --seconds=40 --repeats=3 --cap=120'
    make native-game-bench-ui-test ARGS='--cancel'
    make native-game-bench-ui-test ARGS='--run --mode=manual --output=HDMI-A-2 --cpu-temperature-check=false --control-seconds=30 --wallpaper-seconds=45'

Optional harness arguments include --source, --source-id, --experiment, --fps,
--wallpaper-outputs=DP-2,DP-5, --span=true, --output=DP-5, --preset=low,
--policy=normal, --resolution=current and --demo=/absolute/path.dem.
These tests move the selected game display to a temporary workspace and restore it.
The ordinary wallpaper library and existing renderer switches remain available.

Read [the original Bench report](GAME-BENCH-REPORT.md) and
[the live recording report](LIVE-BENCH-REPORT.md) for validation and results.

## Current graphics incident

GPU testing was paused on 2026-09-08 after purple display flickering and kernel AMD
GPU faults involving Hyprland. DP-2 is connected to the AMD integrated GPU; the
main and right displays use NVIDIA. Manual gameplay and live/history controls were
visually verified on HDMI-A-2. DP-2 gameplay captures turned black and are not valid
performance evidence. The root cause is unresolved. See [the current report](LIVE-BENCH-REPORT.md)
before resuming hardware experiments.

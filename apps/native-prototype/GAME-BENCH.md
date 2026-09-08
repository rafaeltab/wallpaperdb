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
limit, replay interval and number of pairs. **Start comparison** owns the temporary
setup until it finishes or you choose **Cancel and restore**.

Uncheck **CPU temperature check** in the Bench panel to disable its 96°C / three-second
cutoff for that comparison. The checkbox starts enabled. Your choice is included
in the result and exported JSON; CPU temperature readings are still collected.
GPU temperature, free RAM/VRAM, resource freshness and time-limit checks stay active.

The game display can differ from the wallpaper displays. **Keep playing** measures
active wallpaper interference. **Normal policy** measures the existing fullscreen
pause behavior; a shared spanning producer continues if another selected display
is still visible. The result validates the observed surface and producer policy.

The first run records local bots on Dust II using the installed game build. It
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
CS2 accepted 1600×900 but clamped a 2560×1440 request to 1920×1080. Bench records
actual engine dimensions and rejects a mismatch; it never changes monitor modes.
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
- **Save comparison JSON** exports inspectable plots, summaries and metadata.
  The latest successful comparison also reloads after restarting the prototype.

Source2's native individual-frame CSV supplies application swap intervals. Bench
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

Jobs have a 15-minute limit, individual scene deadlines and existing temperature,
free-VRAM and free-RAM guards. Cancellation and graceful host exit attempt every
cleanup independently. Owned game processes and external players use pidfd identity
handles. Forced process kills or a power failure are not crash-safe recovery;
durable backups are retained, but there is no production recovery service.

Chromium DMA-BUF remains unavailable for Bench because it failed earlier pixel
validation. Missing frames, renderer errors, reported black output, unverified
pause/playback state, incomplete game traces and restoration failures cannot be
reported as successful comparisons.

## Developer checks

    make native-game-bench ARGS='--discover'
    make native-game-bench-test
    make native-game-bench-ui-test
    make native-game-bench-ui-test ARGS='--temperature-option'

The UI harness connects to the actual running local library. To exercise the game:

    make native-game-bench-ui-test ARGS='--run --seconds=40 --repeats=3 --cap=120'
    make native-game-bench-ui-test ARGS='--cancel'

Optional harness arguments include --source, --source-id, --experiment, --fps,
--wallpaper-outputs=DP-2,DP-5, --span=true, --output=DP-5, --preset=low,
--policy=normal, --resolution=current and --demo=/absolute/path.dem.
These tests move the selected game display to a temporary workspace and restore it.
The ordinary wallpaper library and existing renderer switches remain available.

Read [the Bench report](GAME-BENCH-REPORT.md) for the actual validation and results.

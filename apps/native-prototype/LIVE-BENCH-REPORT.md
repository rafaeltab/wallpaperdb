# Live Bench prototype checkpoint — 2026-09-08

The requested live recording and history workflow is implemented. Validation is
incomplete: GPU experiments were stopped after the user reported rapid purple
monitor flickering. Kernel logs contain AMD GPU memory faults and a Hyprland GPU
timeout. Do not resume hardware tests in the affected graphics session.

## What changed

The library now has separate setup, results and history views:

1. Select a wallpaper and choose **Bench**.
2. Set game, display, renderer and recording options, then start.
3. The results view opens and draws the incoming measurements about once per second.
4. Return through **Benchmarks**, select a saved run and use **View parameters** to
   inspect the submitted options. History cards include wallpaper, game and options.

Automatic replay comparisons remain available. The new **Continuous gameplay ·
stop manually** mode opens one offline CS2 Dust II bot game. Start control recording
when ready, switch to the wallpaper recording when desired, and choose **Stop and
save** to finish. Both phases use the same game process. Control and wallpaper
durations are independent; stopping before a complete pair saves the available
measurements without manufacturing a comparison.

The result status explicitly says **Recording control benchmark** or **Recording
wallpaper benchmark**. Live statistics are provisional. Automatic Stop preserves
completed trials and excludes an interrupted trial from the paired comparison.
Cancel remains separate from Stop and save.

The native library window stays on its existing output and workspace. A warning
appears when its output is also selected for the game. Results can be closed and
reopened during capture; the native window itself cannot close until the run is
stopped or cancelled. The earlier CPU temperature checkbox remains available.

## Functional verification

The real library UI harness exercised setup, both live recording phases, Stop,
history reopening, parameter inspection and JSON export. The native window stayed
on DP-5, where the user had placed it. Graphs changed throughout each phase.

The visible gameplay test was `game-1788897490910101093` on HDMI-A-2:

| Phase | Captured duration | Frames | Distinct live UI updates |
| --- | ---: | ---: | ---: |
| Control | 31.908 s | 3,804 | 30 |
| Wallpaper | 47.548 s | 5,676 | 45 |

CS2 Dust II was visibly rendering on that output. The game was capped at 120 FPS;
the saved averages were 119.22 and 119.38 FPS. These establish that the collection
flow works, **not** a renderer performance advantage. Gameplay was unmatched and
the owned game window was changed to fullscreen during functional inspection.
The game rendered at 1600×900 within the larger display; this was not a validated
1440p workload. Manual mode records requested dimensions without independent engine
resolution verification.

Two completed DP-2 attempts produced black gameplay captures despite valid-looking
frame CSVs. Jobs `game-1788897319895789780` and `game-1788897649716759755` have been
marked invalid, their comparisons cleared, and their original JSON and raw data
retained. They must not be used as performance evidence. A subsequent automatic
replay attempt, `game-1788897771959079174`, was cancelled during warmup when the user
reported flickering; it completed no measured trials.

The new incremental Source2 reader was also checked offline against a previously
saved real trace, fed in 1,027-byte chunks. Its completed measured interval exactly
matched the existing full-file parser. All six manual phase summaries were
independently recalculated from their CSVs and matched the saved numbers. Numerical
agreement does not validate the black DP-2 pictures.

## Long-session behavior and performance limits

Manual recording uses a private MangoHud 0.8.4 configuration and a continuous
per-frame Vulkan CSV. The worker selects phase ranges and excludes loading and
wallpaper transitions. It validates elapsed-time coverage before accepting a phase.
No global MangoHud settings are changed. Autostart with `no_display` did not work in
the tested version, so the HUD is transparent and positioned outside the viewport.
Proton's multiple Vulkan instances collided when using MangoHud's optional control
socket; the final implementation does not use that socket. See upstream
[overlay code](https://github.com/flightlessmango/MangoHud/blob/v0.8.4/src/overlay.cpp)
and [logging code](https://github.com/flightlessmango/MangoHud/blob/v0.8.4/src/logging.cpp).

Live timelines retain at most 1,200 frame buckets and 1,200 resource samples per
phase. Frame buckets preserve minima and maxima while coarsening, so a single
large hitch remains visible. Exact frame values use eight bytes each; live
percentiles use 1 µs bins, and final statistics are recalculated from exact values.

A CPU-only synthetic ingestion check modeled 30 minutes at 360 FPS:

| Item | Observation |
| --- | ---: |
| Frames ingested | 648,000 |
| Final timeline buckets | 1,126 |
| Exact frame array | 5,184,000 bytes |
| Ingestion process CPU time | 0.647 s |
| Inserted 250 ms hitch | Preserved |

This is a data-structure check, not measured game overhead. It excludes MangoHud,
kernel monitoring, resource sampling, IPC, the visible UI and rendering. Raw CSVs,
the worker's exact values and MangoHud's own buffer grow with recording duration.
Final sorting also needs temporary memory and time. No end-to-end long gameplay
soak or collector overhead comparison was completed in this session.

Manual capture has no fixed session duration. Its finite 15-minute idle/sleep
inhibitor renews with overlap; creation, renewal and release were checked against
real systemd registrations. Resource freshness, free RAM/VRAM, disk space and GPU
temperature checks remain active. Disabling the CPU temperature cutoff does not
disable these other checks.

## Purple flicker incident

Around 22:01 local time, the kernel reported AMD GPU memory page faults followed
by `ring gfx_0.1.0 timeout`, involving Hyprland PID 3259. The device is the AMD
integrated GPU at PCI `0000:15:00.0`, distinct from the NVIDIA RTX 4080.

| Output | Physical GPU | Display |
| --- | --- | --- |
| DP-2 | AMD, card0 | Top AOC |
| DP-4 | NVIDIA, card1 | Left rotated AOC |
| DP-5 | NVIDIA, card1 | Main AW2725DF OLED |
| HDMI-A-2 | NVIDIA, card1 | Right AOC |

This mapping was verified from sysfs and EDID. The rendering/presentation path
between the two GPUs is a suspect, not an established cause. DP-2's owned game
window was briefly toggled between windowed and fullscreen during the black-screen
investigation near the fault time. The evidence does not isolate a renderer,
MangoHud, screenshot capture, the compositor, or a driver as the initiating cause.
It also does not establish hardware damage or rule it out.

The response was to cancel the owned CS2 job, verify its exit, save and clear all
prototype wallpaper assignments, and remove the owned OLED cover. The user's
external video was restored by job cleanup. The library was not moved. No GPU
reset, compositor restart, display-mode/DPMS change, suspend, reboot or shutdown
was issued during incident handling. Recent kernel checks after stopping showed
no additional GPU faults; the user's physical-display confirmation is still pending.

The earlier black DP-2 captures should have caused GPU testing to pause sooner.
Temperature/resource guards did not detect this failure mode. A new kernel journal
watcher now stops Bench on recognized GPU faults, including the other GPU used by
the compositor. A receipt tied to the boot and Hyprland session blocks new Bench
jobs and wallpaper application for that affected session, and restoration leaves
prototype surfaces stopped with the original assignments in the job backup.

This guard detects reported faults after they occur; it cannot prevent the first
fault or guarantee hardware safety. Parsing, session blocking and actual journal
subscription/cleanup were tested without GPU work. A real GPU fault was not
deliberately repeated to test recovery. The rebuilt host has not been restarted
into this suspect session; its new UI/host checks take effect on a later launch.
The Python worker preflight already reads the installed block receipt.

## Checks and remaining work

- Release build, Rust formatting and Clippy passed; 16 Rust and 6 runtime JavaScript
  tests passed.
- 33 Bench Python tests passed. The broader native laboratory suite passed
  160 Python and 2 C tests.
- Native web formatting and Bench Python formatting completed.
- Repository-wide `make ci` could not run because `vitest` is missing from this
  checkout. `make format` could not run because the repository's Turbo executable
  is missing. These are not reported as passing.
- Fresh automatic replay validation, a long real gameplay recording, manual
  cancellation/failure variations and end-to-end collection overhead measurements
  remain to be exercised once graphics stability is understood. None should be
  run merely to reproduce flickering in the current session.

Saved local evidence is in
`/tmp/wallpaperdb-bench-live-session-1788894771`: `INCIDENT.md`, kernel faults,
connector mapping, before/after state, screenshots, original assignments and
`offline-verification.json`. Job data remains under
`~/.local/share/wallpaperdb-native-prototype/benchmarks/`. These are private local
artifacts and are not committed. A copy of this report is saved to
`/tmp/wallpaperdb-bench-live-report-2026-09-08.md`.

Work is paused at an offline checkpoint. The user's earlier request to suspend
after completion has not been executed while the display incident is unresolved.
The session receipt records the keep-awake lease and its cleanup state.

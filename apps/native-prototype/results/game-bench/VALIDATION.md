# Bench validation record

8 September 2026. All results here were obtained on this workstation. Read the
[final report](../../GAME-BENCH-REPORT.md) for the performance conclusions and
[open the interactive results](index.html) to inspect the frame traces.

## Completed game comparisons

Every row completed through the real local library's Bench controls, including
progress, mutation locking, result charts, responsive layout, and exact wallpaper
assignment restoration. All use the same locally recorded and successfully replayed
CS2 scene, SHA-256
`f2d0f5b22f8db3b5131b098acf538ee24f6bc689920972de84369091ebe62db1`.
The game ran on DP-5 at an observed 1600×900; no display modes were changed.

| Check | Wallpaper placement / policy | Pairs | Evidence |
|---|---|---:|---|
| Automatic recording, warmup and default comparison; Prism / native | DP-2, active | 1 | [game-1788843279100873085](game-1788843279100873085/comparison.json) |
| Fixed heavy shader / native Lua–OpenGL | DP-2, active | 3 | [game-1788843638192773398](game-1788843638192773398/comparison.json) |
| Same fixed heavy shader / Chromium bitmap | DP-2, active | 3 | [game-1788843887837261472](game-1788843887837261472/comparison.json) |
| Same fixed heavy shader / WebKit | DP-2, active | 3 | [game-1788844139482249281](game-1788844139482249281/comparison.json) |
| Retained 3840×2160 image / native; Low game request | DP-2, active | 1 | [game-1788844540904074009](game-1788844540904074009/comparison.json) |
| 3840×2160 video / mpvpaper | DP-5, active behind game | 1 | [game-1788844696421850088](game-1788844696421850088/comparison.json) |
| Same video / mpvpaper, verified stopped playback | DP-5, normal fullscreen pause | 1 | [game-1788845303702721147](game-1788845303702721147/comparison.json) |
| Prism / paced native, producer continues on visible output | DP-2 + DP-5 span, normal | 1 | [game-1788845465336526041](game-1788845465336526041/comparison.json) |
| 3840×2160 video / independent media clock | DP-2, active | 1 | [game-1788845620927309800](game-1788845620927309800/comparison.json) |
| Same video / independent media clock with busy-frame drop | DP-2, active | 1 | [game-1788845776599816072](game-1788845776599816072/comparison.json) |

This is **10 comparisons, 32 measured runs, and 10 excluded warmups**. The three
renderer comparisons use High game settings and a 360 FPS limit. Other rows use
a 120 FPS limit. Single-pair capped cases are functional checks, not renderer
rankings or evidence of a small performance advantage.

The fixed heavy shader redraws a constant scene, fixed pointer and time phase,
with silent audio and no signals or media. It provides a controlled rendering load;
it does not represent every live wallpaper workload.

The export command reparsed each original per-frame CSV, reselected the exact tick
interval and recomputed frame counts, average FPS, p99 and worst-frame statistics.
These match the saved analysis. A separate read-only review also recomputed the
plot envelopes and paired summaries. Raw CSVs and sanitized comparison JSON are
included here; personal game config backups and process/control credentials are not.

Every export also rechecks the observed full-resolution render-target MSAA against
the submitted config. Compare [Low: one sample](game-1788844540904074009/1-control-render-targets.txt)
with [High: four samples](game-1788843638192773398/1-control-render-targets.txt).
Those extracted render-target lines are retained for every measured run, including
runs captured before this observation became a required worker check. The engine's
legacy CPU/GPU-level summary did not change with Low, so it is not treated as proof
that the full settings bundle took effect. Cap and VSync remain submitted settings.

## Failure, cancellation and restoration

Private evidence remains under
`~/.local/share/wallpaperdb-native-prototype/benchmarks/`.

| Check | Outcome | Private job ID |
|---|---|---|
| Cancel from the real UI after startup | Cancelled; controls re-enabled and groups restored | `game-1788845967342567809` |
| Deliberately missing custom replay | Failed with a useful error; groups restored | `game-1788845975427408716` |
| Stop the host while its owned CS2 window is visibly fullscreen | Worker cancelled, game removed, settings restored, then host exited | `game-1788846066486439148` |
| Restart after that host stop | Exact groups restored; latest successful comparison reloaded | `game-1788845776599816072` |

The first fullscreen-video-policy attempt, `game-1788844858077527317`, failed
because CS2 reset the compositor fullscreen state during startup. It remains failed
evidence. The adapter now allows bounded setup adjustments and rejects adjustments
that overlap the measured scene. The successful rerun above verifies both the
fullscreen state and stopped video playback. Earlier incompatible/failed replay
attempts and conservative temperature-guard stops were not turned into results.

The final independent restoration audit checked all 14 saved file entries for
original bytes, modes and absence where appropriate, and checked that the game
config tree gained no files. It also verified exact wallpaper assignments, no CS2
processes, original external-player process identity and stopped/running state,
mouse-focus policy, and all monitor modes, positions, transforms, workspaces and
power states. The native library was visibly present on DP-2 after restart.
Forced host kills and power-loss recovery remain unverified; the graceful-stop
check is not a crash-recovery guarantee.

## Automated and visual checks

| Command / check | Result |
|---|---|
| `make native-game-bench-test` | Passed: 24 Bench tests |
| `make native-check` | Passed: Rust format check and warning-free Clippy |
| `make native-test` | Passed: 13 Rust and 6 JavaScript runtime tests |
| `make native-lab-test` | Passed: 149 Python tests, including the 24 Bench tests; both C pacing/media test programs |
| `make native-build` | Passed: release build |
| `make native-format native-game-bench-format native-format-web` | Passed |
| Real local Bench UI harness | Passed for all completed jobs, cancellation and expected failure |
| Persistent-history UI check after restart | Passed |
| Offline report UI check | Passed: all 10 comparisons, both time axes, four resource metrics, 1440 px and 700 px layouts |
| Actual DP-2 screenshot | Inspected; native library and Bench entry visible |
| `make ci` | Blocked at existing sandcastle test: `vitest: command not found` |
| `make format` | Blocked: workspace `node_modules/.bin/turbo` absent |

The repository-wide Node commands are not claimed to pass. The native prototype
has an independent build/test path. Detailed logs and screenshots remain in the
ignored `apps/native-prototype/verification/` directory; successful public frame
evidence is stored beside this file.

## Unattended session

The user explicitly requested continued work, OLED protection and shutdown after
completion. A finite six-hour `idle:sleep` inhibitor was registered and verified
against the running Hypridle configuration. DP-5 had a black, non-interactive cover
between bounded game tests. A screenshot with the pointer moved to DP-2 had all
RGB channels equal to zero. No DPMS or monitor layout changes were used.

The session's setup, functional checks and restoration receipts are temporarily in
`/tmp/wallpaperdb-bench-unattended-2026-09-08/`. A durable final receipt is saved as
`~/.local/share/wallpaperdb-native-prototype/benchmarks/unattended-2026-09-08-final.json`
when releasing the owned cover and inhibitor and requesting shutdown. It records
command acceptance, not an observation that this machine finished powering off.

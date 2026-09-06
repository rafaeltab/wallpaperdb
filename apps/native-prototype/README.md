# WallpaperDB Desktop

A native desktop prototype that turns a local wallpaper collection into images, looping videos, and programmable environments on Manjaro with Hyprland.

It provides a WallpaperDB-themed library window and CLI, independent or spanning display groups, audio and pointer reactivity, keyboard-triggered effects, and automatic suspension when a display sleeps or shows a fullscreen application.

Rust owns the library, layout, process lifecycle, and compositor integration. GTK layer-shell displays still images; mpv renders videos; JavaScript scenes run in WebKitGTK and can combine images, videos, canvas graphics, and live inputs.

The disposable [renderer laboratory](LAB.md) adds a per-assignment switch between that original baseline, Chromium HTML/JavaScript, and native Lua/GLSL with libmpv. It includes HDR reference fixtures, one producer per spanning group, desktop acceptance checks, and a sustained frame-time recorder with a competing GPU workload. Start it with `make native-lab` from the repository root. See [the measured results](RESULTS.md) for working paths and failed experiments.

The [4K stress laboratory](STRESS.md) adds shared heavy scenes, 120–360 fps requests,
a compositor-paced native switch, an independent media-clock switch, genuine
high-rate video sources, repeated contention tests and an interactive
comparison report. It records delivered frames and long frame-time tails alongside
CPU/GPU resources; requested frame rates are not treated as measured throughput.
Read [the final stress report](FINAL-REPORT.md) for the conclusions and validation
status of this extended session.

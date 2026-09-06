# Native wallpaper prototype

Question: can a Rust Wayland host give WallpaperDB a practical, programmable desktop companion on Manjaro / Hyprland?

This is a functional prototype: local persistence, a finished selection UI, and real desktop verification are part of the requested scope.

- [x] Rust CLI, local library and validated monitor-group layout
- [x] Wayland surfaces: still images, accelerated ordinary video, JavaScript scenes
- [x] Shared audio input, pointer input, explicit keyboard events, date and time
- [x] WallpaperDB-themed native library window
- [x] Independent / spanning monitor groups, display changes, pause controls
- [x] Automated tests and eighteen passing DP-2 acceptance checks with measurements
- [x] Usage, authoring contract, decisions, and remaining limits

## Renderer laboratory

Question: which live execution and presentation paths offer useful authoring,
verified HDR transport, and predictable frame times under competing GPU work?
These are disposable experiments. Keep the original baseline runnable.

- [x] Per-assignment experiment and HDR switches in CLI and library UI
- [x] Common native Wayland/EGL presentation helper with color management and frame evidence
- [x] Lua/GLSL scene experiment with image/video composition and host inputs
- [x] Chromium/Electron offscreen experiment with the same HTML bundles
- [x] Reference scenes, HDR image/video ramps, and capability diagnostics
- [x] Sustained profiling: frame intervals, GPU time, CPU scheduling, competing workload
- [x] Real DP-2 checks and scoped DP-5 HDR checks; preserve existing desktop processes
- [x] Comparison report, reproducible commands, and documented negative results

## High refresh stress laboratory

Question: how do the execution paths behave with a busy, full 4K scene at
120–360 fps targets, including contention and long frame-time tails?

- [x] Shared heavy GLSL scenes and a genuine 4K layered video fixture
- [x] Compositor-paced native alternative and explicit renderer FPS limits
- [x] Bounded matrix runner, thermal/memory guards, and honest delivered-frame metrics
- [x] Verify visuals, high refresh scheduling, and pause/reveal lifecycle
- [x] Repeated 4K runs, complexity sweep, media loops, and competing GPU work
- [x] Durable comparison, raw evidence, reproducible commands, and restored desktop

# Prototype findings

Rust is a practical host for this desktop companion. The prototype provides a local library, a native selection window, a CLI, and separate image/video/live renderers. JavaScript gives live wallpapers a useful programming model immediately. WebKit's NVIDIA rendering cost remains the main obstacle to treating this as a production runtime.

## What was verified

The development machine runs Manjaro, Hyprland 0.56.0 at commit `36b2e0cfe0c6094dbc47bd42a437431315bb3087`, WebKitGTK 2.52.5, Rust 1.89, and an RTX 4080 with NVIDIA driver 610.43.03. DP-2 is 1920×1080 at 144 Hz, positioned at `(320, -1080)`. The complete physical-display acceptance run passed on 2026-09-05.

- Seven Rust tests and four JavaScript runtime tests pass. Rust formatting, Clippy with warnings denied, and the optimized build pass.
- Chromium automation exercises the real local API: library loading, search, filters, monitor selection, applying a wallpaper, pause/resume, button and keyboard signals, and layouts at 1440 px and 600 px wide. The native GTK window was also opened on DP-2, and a real Hyprland keyboard event reached its wallpaper.
- All eighteen desktop acceptance checks passed with DP-2 powered on: stationary image equality, changing video frames, paused video equality, executable image and video scenes, pointer movement, keyboard signals, current date/time, real output audio, fullscreen pause/resume, spanning groups, hotplug, and preservation of existing backgrounds.
- Layout checks used real DP-2 plus two temporary compositor outputs, including live video spanning, mixed assignments, hotplug, and rotation with 1.5× scaling. Measured media phase differences were 0.067 s for ordinary video and 0.004 s for the live video sample at the verification point. These are observations, not synchronization guarantees.
- Stop/restart checks verified cleanup of owned processes and restoration of saved groups and pause state. A second daemon was rejected without modifying the saved library. Pausing stops the supplied scene frame loop and releases audio capture.

The earlier capture/timing failures did not recur after DP-2 was powered on. The original verifier had explicitly sent a DPMS-off command for a sleep test, followed by an on command; the user later confirmed the physical monitor was off despite Hyprland reporting it connected and awake. Physical monitor power commands have been removed from verification. A temporary window rule now places the library directly on DP-2 without requesting focus, and is disabled during cleanup. The application itself only observes display power state to pause rendering; it does not turn monitors off.

Generated evidence lives in the ignored `verification/` directory: UI screenshots, DP-2 image/video/live captures, virtual-output captures, `report.json` for the successful eighteen-check run, and supplemental layout, performance, restart, and lifecycle reports. The verification script preserves existing background processes and removes its temporary outputs in cleanup.

Repository-wide `make ci` and `make format` could not run because this checkout lacks its Node workspace dependencies (`node_modules`, Vitest, and Turbo). Native checks do not require that installation; native Rust and web assets were formatted separately. The documentation site was not built.

## Performance observations

Four-second samples of the optimized daemon and its child processes, with the library window closed and DP-2 powered on, from the successful 2026-09-05 run:

| Content | CPU, percent of one core | Proportional RSS |
| --- | ---: | ---: |
| Native stationary image | 0.50% | 129 MiB |
| Ordinary 1280×720 video | 4.46% | 394 MiB |
| Paused ordinary video | 2.48% | 394 MiB |
| Rose hour, audio enabled | 64.87% | 280 MiB |
| Afterglow video scene, audio enabled | 113.55% | 350 MiB |
| Paused live video | 0.50% | 323 MiB |

100% means one logical CPU core, not the whole machine. Proportional RSS divides shared mappings among the processes using them; it does not provide complete GPU-memory accounting. These are short observations in an active desktop session, not controlled benchmarks. The verifier records both proportional and summed RSS when `/proc` permits it. Closing the library explicitly terminates its dedicated web process.

Ordinary video reported `hwdec: nvdec`. Live scene frame callbacks were capped at a requested 30 fps. Native still images have no animation loop. A single audio sampler is shared across active groups. Fullscreen, display sleep, and manual pause suppress cooperative scene work. Closing a scene terminates its dedicated web process.

## Platform decisions and next work

WebKit's normal NVIDIA path initially failed with a Wayland “Missing acquire timeline” error. Disabling NVIDIA explicit sync alone made image scenes substantially faster, but embedded video stalled. The NVIDIA default therefore uses `WEBKIT_DISABLE_DMABUF_RENDERER=1`. GStreamer CUDA decoders also failed negotiation without NVRTC, so scene media uses a decoder fallback on that installation. Ordinary mpv video retains its separate hardware-decoding path. See the [WebKit synchronization report](https://bugs.webkit.org/show_bug.cgi?id=280210) and the repository ADR for the decision.

This implementation deliberately uses one renderer/decoder per output. Production work should investigate a shared GPU scene and video-decoding pipeline, preferably owned by Rust, while retaining the library and output-group interfaces. Larger scenes, unusual video metadata, other drivers, and WebGL need broader validation. The host frame loop supports pause; arbitrary third-party timers and CSS animations must cooperate separately.

Backend integration can acquire assets into the local library and reuse the same assignment API. Before distributing third-party executable bundles, add asset isolation, process/resource limits, and a trust model. Packaging, installation, autostart, remote catalog/account integration, and Wallpaper Engine package compatibility are outside this prototype.

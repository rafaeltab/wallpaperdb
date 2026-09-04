# Native desktop prototype: Rust host with specialized renderers

Status: prototype decision, 2026-09-04.

WallpaperDB needs to display still images, videos, and programmable live wallpapers on Manjaro / Hyprland, with local file selection now and backend integration later.

Use Rust for local library persistence, validated output groups, compositor input, playback lifecycle, and CLI/control transport. Use native GTK layer-shell / Cairo for still images, managed mpvpaper / libmpv processes for ordinary videos, and dedicated WebKitGTK contexts for executable HTML/JavaScript scenes. Present the library in a separate native GTK window using the website's dark surfaces, Noto Sans typography, and pink accent.

Renderer selection makes the cheapest path the default for each content type: still images have no animation loop; video uses libmpv's hardware-decoding path; arbitrary scene programs pay for a web engine only when they need it. Closing the library window leaves the daemon running and releases the UI webview. A typed local library and one JSON control interface keep rendering independent of how the future catalog downloads files.

Output groups are non-overlapping. A spanning canvas is the bounding rectangle of connected group members in compositor logical coordinates. Each output crops that canvas; disconnected members retain their saved assignments and rejoin on reconnect. Video playback uses a common timeline with bounded drift correction, rather than independent start times.

JavaScript is the prototype authoring language because it immediately supports image/video composition, Canvas/WebGL, and clocks without designing a new language. The host supplies output audio levels, pointer position, and explicit keyboard signals. It never installs a global typing listener. Scenes cooperate with frame-budget and pause events; arbitrary untrusted scripts are not yet supported.

The NVIDIA validation discovered two material platform constraints. WebKit's accelerated path caused a compositor protocol error. Disabling NVIDIA explicit sync alone made image scenes efficient but left embedded video stalled, including with video synchronization seeks removed. The default therefore uses WebKit's compatible rendering path on NVIDIA, with higher live-scene CPU cost. GStreamer's CUDA conversion also failed without NVRTC; scene video receives a decoder fallback in that configuration. Ordinary videos retain libmpv's separate hardware-decoding path.

For a production runtime, investigate sharing video decode / GPU textures across outputs and replacing WebKit's scene rendering with a Rust GPU renderer plus a constrained scripting or WASM API if the measured live-scene overhead is unacceptable. Keep the output-group model and library/control seam. Add package installation, sandboxing, process/resource limits, backend asset acquisition, and compositor-event-driven suspension before distributing third-party bundles.

Primary references: [layer-shell protocol](https://wayland.app/protocols/wlr-layer-shell-unstable-v1), [mpv crop and hardware decoding](https://mpv.io/manual/stable/), [WebKit NVIDIA synchronization issue](https://bugs.webkit.org/show_bug.cgi?id=280210), [Hyprland output management](https://wiki.hypr.land/0.54.0/Configuring/Using-hyprctl/). The prototype's usage, authoring contract, and captured acceptance results live with its source.

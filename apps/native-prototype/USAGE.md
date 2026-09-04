# Running the prototype

From the repository root:

```sh
make native
```

This builds an optimized Rust binary, starts the background daemon, and opens the native library window. The first build downloads Rust crates. No website, database, Node dependency installation, login, or network connection is needed at runtime. Use a terminal in your Hyprland session; a single local session is also discovered automatically.

The library starts with two images, an eight-second original video, and two executable live wallpaper bundles. **DP-2 is the initial UI selection.** Select a wallpaper and press **Apply wallpaper**. Import files with the native chooser; **Import a live folder** accepts a directory with `wallpaper.json`. Import records the existing file location; it does not copy or delete your original files. Keep imported files in place.

Select multiple monitors on the layout map and choose **Span selection** for one continuous scene. **Per display** fills every selected monitor separately. Applying a different wallpaper to one member removes that member from its previous group and recomputes the remaining group's span. Unselected outputs keep their assignments. Gaps, negative coordinates, rotation, and scaling are included in the logical canvas.

Closing the library window releases its webview; wallpapers continue. The prototype does not edit Hyprland configuration or enable itself at login.

## Manjaro dependencies

The verified machine already had these installed. For another machine:

```sh
sudo pacman -S --needed base-devel rustup gtk3 gtk-layer-shell webkit2gtk-4.1 \
  gstreamer gst-plugins-base gst-plugins-good gst-plugins-bad gst-libav \
  ffmpeg libpulse grim
```

Install `mpvpaper` from Manjaro's available package sources / AUR (for example `yay -S mpvpaper`). It embeds libmpv and is required for ordinary video wallpapers. PipeWire with `pipewire-pulse`, or PulseAudio, supplies the system-output monitor for audio reactivity. The CLI reports a missing dependency when its feature is used. The tested Rust compiler is 1.89; dependencies are locked in `Cargo.lock`.

## CLI examples

```sh
make native ARGS='monitors'
make native ARGS='add "/absolute/path/my image.jpg"'
make native ARGS='set "/absolute/path/my image.jpg" --outputs DP-2'
make native ARGS='set "/absolute/path/movie.mp4" --outputs DP-2'
make native ARGS='set apps/native-prototype/examples/rose-clock --outputs DP-2 --audio --fps 30'
make native ARGS='set apps/native-prototype/examples/tide --outputs DP-2 --audio'

# Substitute monitor names from the monitors command.
make native ARGS='set "/absolute/path/panorama.jpg" --outputs DP-2,DP-5 --span'
make native ARGS='set "/absolute/path/video.mp4" --outputs DP-2,DP-5 --span'
make native ARGS='set "/absolute/path/another.jpg" --outputs HDMI-A-2'

make native ARGS='pause --outputs DP-2'
make native ARGS='resume --outputs DP-2'
make native ARGS='clear --outputs DP-2'
make native ARGS='status'
make native ARGS='stop'
```

Pause/resume acts on the entire group containing the selected output, preserving a spanning group's timing. Automatic fullscreen / DPMS suspension is per output. Spanning videos rejoin their common timeline on resume. Video is always muted and looped. Live scene frame budgets range from 1–60 fps; videos retain their source frame rate. The UI's animation selector applies to live scenes.

`clear` removes only surfaces owned by this application, revealing the underlying background. `stop` stops the daemon and its own video/audio children; it keeps the saved library and groups for the next launch. Existing swww or mpvpaper processes are never killed.

## Keyboard and pointer interaction

The pointer is sampled from Hyprland's IPC and is available even while another application is focused. Ordinary wallpaper surfaces pass clicks through and never request keyboard focus.

In the library window, Space or **Send a pulse** sends a semantic keyboard event to selected outputs. For a shortcut that works while another app is focused, add an explicit binding yourself, using the absolute path to the built binary:

```ini
bind = SUPER SHIFT, W, exec, /absolute/path/to/repo/apps/native-prototype/target/release/wallpaperdb-native signal key Space --outputs DP-2
```

The prototype does not listen to arbitrary typing in other applications. It supports an optional desktop interaction mode:

```sh
make native ARGS='interact --output DP-2'
# Click the exposed wallpaper to focus it; press keys or click for effects.
# Escape restores click-through mode; this command also always exits it:
make native ARGS='interact --output DP-2 --off'
```

Audio is opt-in per group (`--audio` / **System audio**). One sampler reads the default playback monitor and shares RMS and sixteen frequency bins. It never selects a microphone. Capture stops when no active scene requests audio.

## State, troubleshooting, and development

Library and groups: `$XDG_DATA_HOME/wallpaperdb-native-prototype/library.json`, falling back to `~/.local/share`. `WALLPAPERDB_NATIVE_DATA` can point to an isolated test directory. Writes use a temporary file followed by rename. Corrupt state is reported and preserved.

Control socket and startup log: `$XDG_RUNTIME_DIR/wallpaperdb-native-prototype/`. The `url` file identifies the loopback-only UI endpoint. Its port is selected automatically; `daemon --port 48732` fixes it. CLI traffic uses a private Unix socket; browser mutations require the session token and same origin. Status includes per-output telemetry, video decoder information, and errors. Individual mpv logs are alongside their control sockets.

On NVIDIA, the host defaults to WebKit's compatibility renderer to avoid a “Missing acquire timeline” protocol error and live-video stalls observed on the verified RTX 4080 / Hyprland system. This increases live-scene CPU cost; it does not affect native images or mpv video decoding. Merely disabling NVIDIA explicit sync made image scenes faster but left embedded video stalled, so that setting is not the default. Existing environment overrides are respected. Other GPUs retain WebKit's default accelerated path. To request compatibility rendering explicitly on another setup:

```sh
make native ARGS='stop'
WEBKIT_DISABLE_DMABUF_RENDERER=1 make native ARGS='daemon'
```

When NVIDIA's `libnvrtc.so` is absent, WebKit video scenes avoid the CUDA decoders that failed negotiation on the verified installation. This can mean software decoding inside live scenes. Ordinary videos use mpv's `hwdec=auto-safe` path and report the actual decoder in `status`.

```sh
make native-build
make native-test
make native-check
make native-format
make native-ui-test  # Requires a local Chromium; CHROME=/path/to/chrome is supported.
make native-verify   # Changes DP-2; creates and removes two temporary virtual outputs.
make native-assets  # Rebuild original bundled illustrations/video; requires rsvg-convert.
```

For faster Rust iteration, use `make native NATIVE_CARGO_FLAGS= ARGS='daemon'`. The default build is optimized. The binary currently locates bundled examples relative to this source checkout; packaging a relocatable application is a future step.

`native-verify` captures screenshots and measured process-tree CPU/RSS under `verification/`, tests actual video frame changes and paused-frame equality, injects a quiet two-second test tone, briefly tests fullscreen on DP-2, verifies all wallpaper types across groups, and leaves Rose hour running on DP-2. A temporary window rule makes its native library open directly on DP-2 without requesting focus; the rule is disabled during cleanup. The verifier preserves existing background processes and removes its virtual outputs even when a check fails. Other physical outputs are not used for test assignments, and no monitor power commands are issued.

All eighteen acceptance checks passed with DP-2 powered on. The earlier capture/timing failures did not recur after the display was turned on; the verifier's physical display-sleep test has been removed. Keep DP-2 awake during verification even if Hyprland reports it connected. Capture commands time out after ten seconds. `GRIM=/path/to/grim make native-verify` can select a different capture binary for diagnosis. See `NOTES.md` for measurements and remaining renderer limitations.

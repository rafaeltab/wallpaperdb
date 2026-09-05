# Renderer laboratory

This is a set of disposable experiments inside the existing prototype. A wallpaper assignment stores its renderer, HDR choice, frame budget, audio choice, and display group. Different groups can use different experiments at the same time. The original baseline and its saved assignments remain usable.

## Try the switches

From the repository root:

```sh
make native-lab
```

Select **Prism laboratory**, choose a **Renderer experiment** in the inspector, and apply it to DP-2. The apply controls stay visible while the inspector scrolls. **Live experiment diagnostics** shows the actual adapter, received frames, output presentations, pixel precision, errors, and log paths. **Keep playing behind fullscreen apps** permits a deliberate performance comparison; otherwise fullscreen apps suspend the wallpaper. Display sleep still suspends it.

| Switch | What runs | Useful scenes | HDR status on this machine |
| --- | --- | --- | --- |
| `baseline` | Original GTK images, mpvpaper video, WebKitGTK HTML/JS | All original bundles; Prism WebGL | These presentation paths are SDR |
| `gpu` | LuaJIT + GLSL, libmpv, native Wayland/EGL presenter | Prism, Rose hour, Afterglow, HDR reference; ordinary image/video files | Verified for live, image, and video reference content |
| `chromium` | Electron HTML/JS with two bounded bitmap transfer slots | The same HTML bundles, images, videos | SDR only; HDR requests are rejected |
| `chromium-dmabuf` | Electron accelerated shared textures imported by the native presenter | A deliberately exposed interoperability experiment | Failed on this Electron/NVIDIA setup; no silent fallback |

The two Chromium switches make the transfer cost explicit. The working bitmap path copies pixels through CPU memory. The DMA-BUF path keeps at most two producer leases and releases each after the consumer's GPU fence. Receiving a buffer is not treated as proof of correct pixels: diagnostics flag sampled black content, and HDR checks compare actual scene values.

```sh
make native ARGS='set apps/native-prototype/examples/prism --outputs DP-2 --experiment gpu --audio'
make native ARGS='set apps/native-prototype/examples/prism --outputs DP-2 --experiment chromium'
make native ARGS='set apps/native-prototype/examples/prism --outputs DP-2 --experiment baseline'
make native ARGS='set apps/native-prototype/examples/tide --outputs DP-2 --experiment gpu --audio'
make native ARGS='set "apps/native-prototype/examples/Drifting dusk.mp4" --outputs DP-2 --experiment gpu'

# One simulation/decoder/canvas across a selected group, plus an independent group.
# Substitute connected names reported by `make native ARGS=monitors`.
make native ARGS='set apps/native-prototype/examples/tide --outputs DP-2,DP-4 --span --experiment gpu'
make native ARGS='set apps/native-prototype/examples/prism --outputs HDMI-A-2 --experiment chromium'
```

`make native` and `make native-build` still build only the original Rust application. `make native-lab-build` builds the experiment helpers. After changing embedded UI/Rust code, use `make native ARGS=stop` before reopening the rebuilt app; an already-running daemon continues using its existing executable. Source Lua/GLSL/HTML changes take effect when reapplied.

Ordinary assignments keep compact live diagnostics without continuously writing frame traces. `set --trace` opts into detailed CSV files; `native-profile` enables this automatically. Traces grow while the wallpaper runs, so use them for bounded captures. This keeps normal wallpaper use from gradually filling the session's RAM-backed runtime directory.

## HDR preview and evidence

An HDR surface and an HDR-enabled physical display are separate requirements. `--hdr` requests an FP16 scRGB surface. The dedicated preview command temporarily enables HDR on DP-5 while preserving its mode, position, scale and rotation, then restores the previous settings and wallpaper assignments on Ctrl-C:

```sh
make native-hdr ARGS='--preview prism'
make native-hdr ARGS='--preview tide'
make native-hdr ARGS='--preview "HDR reference.avif"'
make native-hdr ARGS='--preview "HDR reference.mkv"'

# Automated reference probes, quick empty-workspace screenshots, then restoration.
make native-hdr
# Or test just the working native path:
make native-hdr ARGS='--experiments gpu'
```

The reference scene, 16-bit PNG, 10-bit AVIF and 10-bit HEVC video carry patches at 0.1, 1, 10, 80, 203, 300, 400 and 800 cd/m². The verifier reads the actual rendered FP16 scene, compares all RGB channels, checks an accepted scRGB description and presentation feedback, and checks DP-5's ten-bit output, BT2020_RGB connector color space and PQ HDR metadata. Screenshots are SDR captures and cannot prove physical brightness. Wide-gamut accuracy and calibrated panel luminance are outside this experiment's evidence.

Native media is rendered by libmpv into FP16 PQ/BT.2020, converted to linear scRGB, then composed with the shader. Intermediate mpv dithering is disabled; otherwise its render API can assume an eight-bit destination despite the float framebuffer. scRGB uses 1.0 = 80 cd/m², while Chromium's `linear-hdr` source uses 203 cd/m² and requires conversion. [Wayland color protocol](https://gitlab.freedesktop.org/wayland/wayland-protocols/-/blob/main/staging/color-management/color-management-v1.xml), [mpv render implementation](https://github.com/mpv-player/mpv/blob/v0.41.0/video/out/gpu/libmpv_gpu.c).

## Writing native scenes

Keep the normal `wallpaper.json`, `index.html`, and preview in a live bundle. Add `scene.lua` beside the HTML. Selecting `gpu` executes that file; selecting a browser executes the HTML. These are alternative implementations of the scene, not an automatic translation of JavaScript.

```lua
-- Optional image or video, relative to this Lua file. One decoder per group.
media = "background.mp4"
local level = 0
function frame(t, input)
  level = level + (input.audio - level) * 0.16
  return {level, input.hdr and 5 or 1, 0, 0}
end
fragment = [[
void main() {
  vec3 background = mediaColor(uv); // linear scRGB, already decoded and converted
  float wave = .5 + sin(uv.x * 12. + time) * (.03 + params.x * .2);
  float line = exp(-abs(uv.y - wave) * 250.);
  color = vec4(background + vec3(.8,.1,.5) * line * params.y, 1.);
}
]]
```

Lua's `frame(t, input)` maintains arbitrary program state and returns four numbers exposed as GLSL `params`. Inputs are playback RMS (`audio`), normalized group pointer (`x`, `y`), cumulative semantic signal count (`pulse`), and HDR mode (`hdr`). `t` is local active animation time. GLSL also receives `bands[16]`, `pointer`, `audio`, `pulse`, `date` (year, month, day, seconds since local midnight), `time`, `hasMedia`, and `mediaTexture`. `mediaColor(uv)` decodes the intermediate media representation. The shader's output is linear scRGB; the presenter handles SDR encoding or HDR transport.

Prism compares a similar procedural shader in WebGL2/JavaScript and Lua/GLSL. Rose hour and Afterglow demonstrate still-image/video composition with an analog clock, pointer parallax, audio wave and keyboard-driven color variants. Their native appearance differs from the DOM implementations. LuaJIT shares the Lua ABI already used by the installed libmpv; loading a second Lua ABI in the same process caused a real crash during development.

Native scenes use the host's shared playback audio samples and explicit keyboard signals. They never take desktop keyboard focus. Browser `interact` mode remains a baseline feature; native scenes use the library pulse or an explicit Hyprland shortcut. Lua has standard libraries and local file access; these are trusted local programs, not marketplace-sandboxed content.

## Measure pacing

```sh
make native-profile ARGS='--seconds 120 --repeats 3 --warmup 20 --passes 600'
make native-profile ARGS='--seconds 60 --repeats 2 --cases idle --passes 600 --sample-hz 0'
make native-profile ARGS='--seconds 90 --repeats 1 --cases gpu,chromium,baseline --source tide --audio --passes 600'
make native-profile ARGS='--seconds 60 --repeats 1 --cases gpu-paused,chromium-paused,baseline-paused --passes 600'
```

The recorder closes this application's library window and temporarily clears its existing wallpaper groups so unselected prototype wallpapers cannot contaminate an idle measurement. It restores the saved groups afterward. Existing swww/mpvpaper backgrounds and other applications remain running. The 1280×720 click-through contender appears on DP-2; it is a fixed synthetic shader workload, not a game or a claim about game FPS. It must report NVIDIA rendering; the alternative renderers also identify their presenter adapter in saved telemetry. WebKit does not expose an adapter in its existing host telemetry. DP-2 scans out through AMD, so results include cross-GPU presentation.

Raw CSV/JSON and a standalone interactive HTML report go under `verification/profile-TIMESTAMP/`. Select a run and time window to inspect presentation intervals beside wallpaper, compositor and recorder CPU, and total NVIDIA utilization. The recorder retains actual presentation timestamps and refresh sequences, delayed nonblocking GPU timers, submission elapsed time, process CPU clocks, RSS, GPU utilization/power/clocks/temperature, telemetry and artifact hashes. Percentiles include p99.9 and worst frame; sequence gaps expose missed refreshes that a median hides.

Refresh sequences count display refreshes between presentations. Gaps greater than one indicate missed opportunities for the 144-fps contender on a 144-Hz display; they are normal for a wallpaper deliberately capped at 30 fps. Summed process RSS includes shared pages and is not unique memory usage. The recorder does not attribute GPU VRAM or AMD compositor work to individual applications.

CPU clocks include exited threads; membership is discovered after warmup and checked afterward. Failed, restarted or stopped animated renderers invalidate a run. `--sample-hz 0` removes CPU/NVML/status sampling during measurement while retaining buffered frame records. It measures collector overhead, not the overhead of frame recording itself. NVML integrates a coarser native window than the polling interval and cannot assign a millisecond hitch to a particular process. Presenter GPU timing also excludes Chromium production/import and asynchronous media decoding. [NVML averaging contract](https://docs.nvidia.com/deploy/nvml-api/structnvmlUtilization__t.html).

## Dependencies and checks

In addition to [baseline dependencies](USAGE.md#manjaro-dependencies), the lab uses a C compiler, `pkg-config`, Wayland development headers/protocols and scanner, EGL/OpenGL, libepoxy, libmpv, LuaJIT, json-c, Node headers, and Electron 42. Manjaro package names on the tested installation include `wayland`, `wayland-protocols`, `libepoxy`, `mpv`, `luajit`, `json-c`, `nodejs`, and `electron42`. `WALLPAPERDB_ELECTRON` can select another Electron executable; shared-texture APIs are version-sensitive. The tested combination is documented in [results](RESULTS.md).

```sh
make native-lab-build native-build
make native-test native-check native-ui-test
make native-lab-verify  # DP-2 plus temporary virtual outputs; no power commands
make native-lab-verify ARGS=--lifecycle-only  # Focus on spans, fullscreen and reconnects
make native-lab-assets  # Regenerate HDR fixtures and native clock background
make native-lab-format native-format-web
```

The C helper and Node addon are local throwaway code in `lab/`; no npm install is needed for Electron runtime operation. Formatting uses clang-format, a locally isolated Black formatter, and pinned Prettier. The lab does not install services, autostart entries, bindings or persistent Hyprland configuration.

Failed desktop waits save compositor and renderer state beside the verification report. `--debug-stacks` additionally attempts a helper stack capture with GDB; this machine's ptrace policy rejects attachment from the verifier, which is recorded rather than changing system policy.

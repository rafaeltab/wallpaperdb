# Stress studio

A disposable performance workload: can the wallpaper engines sustain the same complex scene at a genuine 3840×2160 backing size and high requested frame rates? The scene combines a kinetic sculpture, two multi-octave fields, seeded lights and stars, translucent foreground rings, a spectrum and a civil-time clock. The media version also composites one 4K60 video texture. The vector previews are illustrations, not measured screenshots.

## Choose a workload

Import the directory in the first column. Each is a normal live bundle with HTML/WebGL2 and a sibling Lua/GLSL entry. Select **Chromium** or **Lua / GPU** using the existing renderer control.

| Bundle, relative to this directory | Ray-step budget | Field octaves | Surface lights | Decoders |
| --- | ---: | ---: | ---: | ---: |
| `.` | 24 | 3 | 8 | 0 |
| `shader-light` | 12 | 2 | 4 | 0 |
| `shader-heavy` | 40 | 4 | 12 | 0 |
| `media-heavy` | 40 | 4 | 12 | 1 |

`workloads.js` is the only workload table, including seed **173**. Both adapters read it. Rays can terminate early after hitting an object or leaving the scene, so the step count is a budget, not a promise that every pixel executes every step. Both fields execute the selected octave count; lights are evaluated on visible sculpture surfaces. There is one full-screen scene draw per requested scene frame and no deliberately repeated draws. The three shader presets change actual image detail and lighting as well as rendering cost.

Keep the whole `stress-studio` directory together: the three child bundles intentionally load their parent's shared files. No query-string support or host changes are needed. Do not change the table while a comparison is running; restart both engines after a change.

## Generate the media fixture

From the repository root, the exact generator entry point is:

```sh
python3 apps/native-prototype/scripts/stress-assets.py --dry-run
python3 apps/native-prototype/scripts/stress-assets.py --encoder h264_nvenc --timeout 180
```

The first command only prints the plan. The second rasterizes original deterministic vector art, then encodes exactly **480 frames / eight seconds / 60 fps**. It needs `rsvg-convert`, `ffmpeg`, `ffprobe`, 256 MiB free space, and a working selected encoder. For an explicitly chosen CPU alternative, use `--encoder libx264`; it never switches encoders automatically. CPU threading is bounded to four codec threads and two filter threads; each child command has a deadline, and video output is capped at 100 MB. Encoding is separate from playback measurements and must finish before they begin.

Generated paths:

| Path | Purpose |
| --- | --- |
| `background-4k.png` | Standalone **3840×2160** still control; the first view of the video camera path |
| `background-4k.mp4` | Shared **3840×2160, H.264, 60 fps, eight-second** SDR video; import directly for a video-only control |
| `fixture.json` | Encoder, dimensions, frame count, source description, color metadata and SHA-256 hashes |

The PNG source is rasterized from vectors at 4096×2304, and a slowly moving 3840×2160 crop creates the video without upscaling. Pixel positions are rounded by the video crop filter. Video primaries and YUV matrix are BT.709, transfer is sRGB, and YUV range is limited. An explicit H.264 metadata filter writes those color fields into the bitstream; the generator rejects a clip whose probe does not confirm them. Both media scenes resolve to this same MP4 file and each creates exactly one decoder. The generated files are ignored by Git; a fresh checkout must generate them before selecting `media-heavy`. Missing media is a failed workload, not a shader-only fallback.

The slow vector pan is highly compressible: the generated NVENC fixture is about 1.85 MB, or 1.85 Mbit/s over eight seconds. This exercises full 4K decoded frames and texture composition, but does not represent high-bitrate film grain or worst-case decoder complexity. The live workload concentrates on GPU shader work; it does not model a large animated DOM or CPU-heavy JavaScript simulation.

## Inputs and reproducibility

Composition uses one fixed shader seed. Animation uses **wall-clock seconds modulo 4096** in both engines: browser `frame.time` and Linux `clock_gettime(CLOCK_REALTIME)` through LuaJIT FFI. This keeps concurrently running instances in the same phase; pausing stops work and resuming joins the current phase. There is a phase discontinuity every 4096 seconds. Record capture times and avoid that boundary when comparing frame-time tails. Different capture times still see different animation; a shared clock does not make sequential runs replay identical frames.

Pointer position tilts the view and moves the glow. Audio RMS brightens the lights; the 16 audio bands shape the spectrum. Any host signal, including the library's Space/key action, changes the palette/orbit phase. The clock and palette also use the same local civil date. For paired performance runs, disable audio, hold the pointer fixed, send no signals and use the same local date and output geometry. There are no CSS animations, workers, timers or private animation loops in the scene. All drawing uses the host's frame callback; video uploads are flagged by `requestVideoFrameCallback` and happen on the next host frame. The host owns video pause/resume.

## What is shared, and what is being compared

`shader.js` contains **one literal GLSL body**. HTML loads it as a local script; Lua extracts that body without copying or translating the shader. This also works with the baseline's restriction on file fetches. GLSL ES 3.00 and desktop GLSL 3.30 get small host-specific declarations plus the same seed constant and body. Lua supplies workload/time parameters; JavaScript supplies the same parameters and host input uniforms. Shader-only output is clamped to SDR's range even when the native presenter uses an HDR surface; use the existing HDR calibration fixtures to investigate bright HDR highlights.

This is source and workload equivalence, not identical GPU pipelines. Chromium compiles through its graphics backend, draws into its offscreen browser surface, and uses the selected browser transport. Native GL draws into the presenter's FP16 scene texture and then presents it. Browser SDR encoding/quantization and native color conversion differ. For video, the browser imports a decoded video frame into WebGL; native libmpv decodes/renders into its media texture. Decoder choice, texture upload/copy cost, filtering and color conversion remain part of the measured engine. The browser adapter assumes its video texture is in sRGB; verify the fixture's appearance on both paths before interpreting color differences. Native playback and browser video are not frame-locked decoders.

The shader uses a 16:9 camera, and the media fixture is 16:9. Compare at **3840×2160 / scale 1**; a 4K monitor at a smaller logical size does not automatically give a 4K scene backing. The scene allocates the host-reported canvas exactly and performs no internal resolution scaling. Requested 120 or 360 fps is a scheduling request; verify actual frame/presentation timing and the helper's real backing size in each capture. WebKit requires working WebGL2, and its installed compatibility path may fail this workload.

Start with the light shader at a lower rate, then standard, heavy and media-heavy. Use the coordinating profiler's time limits, responsiveness guard, paired no-wallpaper control and abort policy. These scene files do not alter monitors, manage a contender, change power limits or authorize an unbounded run. The fixture generator and source creation do not constitute a performance or decoder validation; record those results only after the coordinated run.

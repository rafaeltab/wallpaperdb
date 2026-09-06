# Encoded 4K120 / 4K360 video controls

The 120 and 360 FPS fixtures were generated successfully on 2026-09-06 using
FFmpeg/ffprobe n8.1.2 and `h264_nvenc`. They are local SDR video files under
`examples/stress-studio`, with completed provenance sidecars. The generator,
recipe adapter and Make targets are integrated in the repository.

## Recorded source evidence

Both files contain a 3840×2160 H.264 Main stream lasting exactly 8.000000 seconds,
with YUV420P limited range, BT.709 primaries/matrix and sRGB transfer. The
recorded nominal and average rates agree with their requested rates:

| File | Rate | MP4 samples / demuxed packets | H.264 level | File bytes | Last PTS |
| --- | ---: | ---: | --- | ---: | ---: |
| `background-4k-120fps.mp4` | 120/1 | 960 / 960 | 6.0 | 7,092,125 | 7.991666667 s |
| `background-4k-360fps.mp4` | 360/1 | 2,880 / 2,880 | 6.2 | 11,602,442 | 7.997222222 s |

The verifier checked every sorted presentation timestamp and packet duration:
one slot every 1/120 or 1/360 second from PTS zero, including packet reordering.
The 120 FPS attempt completed at 03:16:41 UTC in 19.984 seconds; the 360 FPS
attempt completed at 03:18:50 UTC in 55.693 seconds. These are generation times,
not playback performance measurements.

The exact recorded SHA-256 values are:

```text
120 FPS: 0b6f2b195c92ed62768f0e2c61c62683108d82e2201e818328d646f00358e49d
360 FPS: 5ce9bf19cbe8a209dcef74b26577f49e5df27110ff5daf7a1251cd4aca6abc6f
```

Full probe fields, source/tool/font hashes, commands and limits are in the
[120 FPS sidecar](../../examples/stress-studio/background-4k-120fps.fixture.json)
and [360 FPS sidecar](../../examples/stress-studio/background-4k-360fps.fixture.json).
Local attempt records are
[video-source-120-attempt1](../../verification/video-source-120-attempt1/generation.json)
and
[video-source-360-attempt1](../../verification/video-source-360-attempt1/generation.json),
with raw probe output, stderr and resource observations beside each manifest.
Both completed manifests record matching before/after hashes for the original
`background-4k.mp4`, `background-4k.png` and `fixture.json`.

This establishes encoded timing and cardinality. No full decoded-pixel
comparison was performed by generation, and these records do not establish
real-time playback, physical 4K360 scanout or HDR. A renderer may reject the
codec level or fail to sustain the source rate; preserve that result.

## Fixture construction and regeneration

`generate.py` rasterizes the original seeded 4096×2304 artwork and crops it to
3840×2160 at the requested input rate. It does not upscale, interpolate or
retime the existing 60 FPS movie. A high-contrast `FRAME %{n}` label is inserted
at each input frame, including when the rounded crop position repeats.
FFmpeg drawtext support is required; there is no counter-free fallback.

The encoder uses NVENC p4, VBR/CQ23, a 22 Mbit/s target and 40 Mbit/s maximum,
with a requested two-second GOP of 240 or 720 frames. This compressible source
tests decoder/cadence behavior. It is not a worst-case high-bitrate workload.
Its counter, GOP and temporal sampling differ from the legacy 4K60 fixture.

Run commands from the repository root. Omitting `--run` prints the generation
plan without launching native tools:

```sh
make native-stress-video-assets ARGS='--fps 120 --evidence-dir apps/native-prototype/verification/video-source-120-next'
make native-stress-video-assets ARGS='--fps 360 --evidence-dir apps/native-prototype/verification/video-source-360-next'
```

At a coordinated capture boundary, actual generation requires `--run`:

```sh
make native-stress-video-assets ARGS='--fps 120 --evidence-dir apps/native-prototype/verification/video-source-120-next --run'
make native-stress-video-assets ARGS='--fps 360 --evidence-dir apps/native-prototype/verification/video-source-360-next --run'
```

Run one rate at a time and inspect its completed manifest before escalating.
These commands refuse existing fixture/sidecar names and existing evidence
directories; the default files already exist on this workstation. For a
separate reproduction, supply `--output-dir` pointing to a new directory and
a fresh evidence directory. The control recipe reads the canonical files under
`examples/stress-studio`; it does not automatically select alternate outputs.

Generation uses a shared 180-second work deadline, four FFmpeg codec/filter
threads, and a four-logical-CPU affinity inherited by helper threads. A 100 MiB
per-file OS limit complements FFmpeg's 99 MiB `-fs` limit. Failed attempts retain
logs and an incomplete manifest, drain their owned processes, remove temporary
media and publish no clip. There is no software-encoder or lower-rate fallback.

Resource guards require GPU below 82°C, CPU below 96°C sustained for three
seconds, at least 1 GiB free VRAM and 8 GiB MemAvailable. The initial gate is
GPU ≤70°C and CPU ≤95.5°C. A hot start is rejected without a cooldown wait in
the generator. Cleanup and manifest writes can extend a few seconds beyond
the work deadline. Generation opens no player or display surface. Generated
movies remain local artifacts and should not be committed.

## Playback controls

`run-controls.py` supplies an isolated recipe to `stress.py` in memory. It uses
the existing guards and output/process/assignment cleanup, preserving default
stress recipes. The six default cases are `idle`, `baseline`, `gpu`,
`gpu-paced`, `gpu-independent`, and `chromium`; the separate Chromium DMA-BUF
diagnostic is excluded.

All cases for one rate receive the same encoded bytes. Baseline uses the native
video path, GPU experiments use libmpv and Chromium uses its browser path.
These compare whole engines, including their decoder choices. The independent
mode retains the fixed-rate scene scheduler while reusing the latest due media
texture between updates. Requested 120/360 FPS and effective application caps
are recorded separately; Chromium's SDR copy path has a 240 FPS cap.

The default recipe has 30-second measurements, one repeat, no contender and an
owned 3840×2160@360 virtual output. The output refresh remains 360 for both
requested rates. Twelve default captures require at least six minutes of
measurement plus warmup, startup and any cooldown. This measures 4K production
and compositor delivery, without asserting physical 4K360 scanout.

Preview the base recipe, then optionally preview the fully applied overrides:

```sh
make native-stress-video
make native-stress-video ARGS='--output-dir apps/native-prototype/verification/video-rate-plan --seconds 15 --repeats 1 --run --list'
```

`--run --list` verifies fixture sidecars/hashes and prints the overridden stress
recipe, then returns without launching captures. A short screen and an explicit
paired study can be requested with fresh output paths:

```sh
make native-stress-video ARGS='--output-dir apps/native-prototype/verification/video-rate-screen --seconds 15 --repeats 1 --run'
make native-stress-video ARGS='--with-contender --output-dir apps/native-prototype/verification/video-rate-paired --seconds 30 --repeats 2 --passes 600 --contender-output DP-2 --contender-fps 144 --contender-black --run'
```

`--rates 120` selects one source. Normal stress overrides such as `--engines`,
`--warmup` and `--cooldown` are forwarded; do not pass `--stage`, since this
adapter defines its own file recipe. Before running, the adapter checks each
sidecar's completion/rate and the movie's exact hash. It adds fixture, recipe
and runner provenance to the study manifest. Give each study a fresh directory
and retain its build identity alongside the results. A failed batch or guard
stops escalation.

Media position/loops, media render calls, scene presentation rate and dropped
frames answer different questions. The
[independent-media analyzer](../independent-media-README.md) examines saved
target-clock records and fresh async position samples, with explicit loop and
timing limits. These SDR file controls complement the separate HDR fixtures.

After generation, local files can be added to the library without assigning a
wallpaper:

```sh
make native ARGS='add apps/native-prototype/examples/stress-studio/background-4k-120fps.mp4'
make native ARGS='add apps/native-prototype/examples/stress-studio/background-4k-360fps.mp4'
```

## Observed playback and decoder control

The first native independent-clock playback capture delivered 120.00 surface
presentations and 119.77 media render updates/s from the 120 source, with
approximately 0.998 media seconds per wall second. The 360 source delivered
358.63 presentations but only 17.43 media updates/s, with approximately 0.556×
playback speed. Every active 360-source case recorded 100% whole-device decoder
activity. Those presentation counters do not prove 360 unique video frames.

The separate `decode.py` diagnostic consumed both full files through NVDEC into
a GPU-resident null output. It observed exactly 960 and 2,880 decoded frames,
with no reported duplicates or drops. FFmpeg's decode-window rates were 206.01
and 206.57 frames/s; including startup they were 197.26 and 203.09. The existing
background mpvpaper video remained active. This establishes successful complete
decoding on this session, without measuring exclusive hardware capacity or
verifying every decoded pixel against a reference hash.

```sh
make native-video-decode ARGS='--output-dir apps/native-prototype/verification/video-decode-control --mode nvdec-null --run'
```

The diagnostic has a shared 60-second work deadline and the same resource
guards as generation. Optional software/hash paths are provided but were not
used for these results. Decoder-only measurements are excluded from renderer
comparison aggregates. See [the stress report](../../STRESS.md) for the full
controls, limitations and subsequent overload experiment.

## Primary references

- [FFmpeg drawtext](https://ffmpeg.org/ffmpeg-filters.html#drawtext-1): input text,
  expansion, build dependencies and zero-based frame number `n`.
- [FFmpeg output options](https://ffmpeg.org/ffmpeg.html#Main-options): `-fs`
  may exceed its requested size slightly; the generator also uses an OS limit.
- [ffprobe options](https://ffmpeg.org/ffprobe.html#Main-options): stream fields,
  packet inspection and packet counting.
- [NVIDIA FFmpeg guidance](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/ffmpeg-with-nvidia-gpu/index.html#decoder-performance-keep-frames-on-the-gpu): keep decoded frames on the GPU to avoid a CPU download in a decoder diagnostic.

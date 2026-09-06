# Retained HDR video in a live scene

This verification fixture uses the existing `examples/HDR reference.mkv` through
the native live Lua/GLSL path. Run `make native-lab-assets` to generate that media;
do not copy or re-encode it. The relative path in `scene.lua` resolves from this
directory to the existing fixture. The HTML only satisfies the live-bundle format;
the HDR check selects a native independent-clock experiment explicitly.

`make native-hdr ARGS='--experiments gpu-independent,gpu-independent-drop'` includes this live case at
120 and 360 scene fps after the standard four references. It checks the eight
unchanged patch luminances, then explicitly re-probes a scene frame that reused
the video texture, pauses/resumes, and re-probes a reused frame again. Diagnostic
readbacks run outside sustained profiling. The harness restores DP-5's prior
settings and assignments using its existing cleanup path.

The helper diagnostic request is `signal` with name `lab-probe` and value
`media-reuse`. It is scoped to both independent-clock variants; it does not alter scene pulse
input. A fresh `probe_frame`, `probe_reused_media=true`, and matching
`probe_patches_scrgb` establish the pixel observation. The request remains pending
if no reused frame is possible (for example scene FPS at or below source FPS),
so callers must use a timeout. This fixture's 120/360 budget exceeds the source
reference video's rate.

This demonstrates renderer pixels and HDR signaling. It does not measure physical
panel luminance or certify general color accuracy.

Both experiments passed all six reference checks on DP-5 in
`verification/hdr-1788671446/report.json`, including this live composition at both
scene targets. Prior monitor settings and HDR metadata were restored exactly.

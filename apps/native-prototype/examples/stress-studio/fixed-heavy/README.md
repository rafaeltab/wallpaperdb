# Fixed heavy benchmark control

This bundle redraws the shared heavy shader with constant inputs on every host
frame. It is an intentionally static image with continuing rendering work,
intended for the disposable 4K benchmark output.

| Input | Fixed value |
| --- | --- |
| Maximum ray steps / field octaves / lights | 40 / 4 / 12 |
| Composition seed | 173 |
| Shader time (`params.w`) | 137 seconds |
| Pointer | Center: `[0.5, 0.5, 0, 0]` |
| Audio RMS / pulse / sixteen bands | All zero |
| Local civil date / seconds since midnight | `[2026, 9, 6, 43200]` |
| Media | Disabled; no decoder |

`inputs.js` is the one numeric input table read by both wrappers. Both also
check it against the parent's shared heavy preset. The original `shader.js`,
`workloads.js`, `scene.lua` and `scene.js` are loaded without modification. No
constant macros are inserted into the GLSL: the existing uniforms retain their
types and values are set at runtime. Each adapter produces the same compiled
shader source as its ordinary heavy counterpart.

The native Lua wrapper keeps the original frame function, then fixes its phase
and overwrites pointer/audio/pulse/bands/date through libepoxy's exported GL
dispatch pointers. It relies on the existing Linux presenter's contract that
`frame()` runs with the scene program current after those common uniforms have
been written. Five additional GL uniform-setter calls occur per frame. It has
no timer or separate render loop.

The browser wrapper supplies one fixed input object to the original scene frame
listener, and does not subscribe the scene to host signals. It leaves the
runtime scheduler and the scene's `gl.drawArrays` call intact. Its small wrapper
overhead remains part of the comparison. The browser and native graphics/color
pipelines are still different.

During the second frame, each wrapper reads the program's uniforms and rejects
any mismatch. Native records a `WDB_FIXED_HEAVY_INPUTS` JSON line in its helper
log; browser records the same proof in `scene.fixed_control` telemetry. This
once-only program-state query happens during warmup and reads no pixels. Native
verifies `params` from the first frame before the presenter sets its identical
value for frame two. Runtime `time`, cursor and signal telemetry can still
describe live host input; the uniform proof describes the shader input.

Use the dedicated `fixed-heavy-control.py` recipe. It requests 360 FPS with
three 30-second repeats of `idle,gpu,gpu-paced,chromium,baseline` on one owned
3840×2160@360 output, with the existing contender/guards/cleanup. It embeds
uniform proof and source hashes in the study manifest. Browser's bitmap path
retains its 240 FPS cap. A failed/unsupported baseline remains a failed run and
the existing guarded runner stops escalation.

Acceptance requires matching uniform proofs, actual 3840×2160 canvas/buffer
evidence, progressing native or browser scene-frame counters, no media, and
separate per-output presentation feedback. Identical pixels may be treated
differently by browser/compositor damage handling; a host draw count does not
guarantee the same delivery rate. The ray marcher still exits early on hits or
escape, but its inputs and resulting spatial workload no longer change between
frames. This control can test variance with fixed inputs; it cannot by itself
attribute variance in the earlier animated media workload to phase.

# Executable live wallpapers

The original baseline runs local HTML/JavaScript programs. The laboratory also runs these programs in Chromium, or a sibling `scene.lua` with GLSL in the native renderer; see [laboratory authoring](LAB.md#writing-native-scenes). It can manipulate the DOM, use Canvas 2D or WebGL, and combine images and `<video>` elements. The bundled `rose-clock` and `tide` directories are complete examples; their behavior lives in JavaScript, not in the JSON manifest.

A bundle contains a `wallpaper.json` like this:

```json
{
  "title": "My living wallpaper",
  "entry": "index.html",
  "preview": "preview.svg",
  "description": "What makes this scene yours.",
  "tags": ["audio", "pointer", "keyboard", "clock"]
}
```

Entry and preview must be files inside the bundle, including after resolving symbolic links. Put media beside the HTML and reference it relatively. Standalone HTML files can also be imported without a manifest. `preview` is optional; ordinary video imports can have a same-name `.jpg`, `.png`, or `.svg` poster.

Create exactly one `#scene` element. The host sizes this to the group's full logical canvas and offsets it to the current monitor's viewport. Size scene content relative to that element or `wallpaper.canvas`; browser `innerWidth` is only the local output width. Browser `vw`/`vh` units are local-output units too, so avoid them for exact cross-monitor alignment. All members must make the same time-based decisions for a seamless span.

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>My scene</title></head>
<body>
  <div id="scene"><img src="background.jpg"><canvas></canvas></div>
  <script>
    const canvas = document.querySelector('canvas');
    canvas.width = wallpaper.canvas.width;
    canvas.height = wallpaper.canvas.height;
    const ctx = canvas.getContext('2d');
    let pulse = 0;
    wallpaper.on('signal', () => { pulse = 1; });
    wallpaper.on('frame', ({time, dt, date, pointer, audio}) => {
      pulse = Math.max(0, pulse - dt);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#f36d9e';
      ctx.beginPath();
      ctx.arc(pointer.x * canvas.width, pointer.y * canvas.height,
        15 + audio.rms * 100 + pulse * 30, 0, Math.PI * 2);
      ctx.fill();
    });
  </script>
</body></html>
```

## Host API, version 1

`window.wallpaper` is available before the scene's scripts execute.

| Member / event | Contract |
| --- | --- |
| `version` | API version, currently `1` |
| `canvas` | Full group `{width, height}` in logical pixels |
| `viewport` | This output's `{x, y, width, height}` within the canvas |
| `on(name, callback)` | Subscribe; returns an unsubscribe function |
| `ready` | Document loaded and scene dimensions installed |
| `frame` | `{time, dt, date, pointer, audio}`; throttled to the requested frame budget |
| `pointer` | `{x, y, inside}`. Coordinates are normalized to the full canvas and may be outside 0–1. `inside` means the cursor is on this particular output. |
| `audio` | `{available, rms, bands, error?}`. RMS and sixteen log-spaced frequency magnitudes are 0–1; unavailable audio yields zeros. |
| `signal` | `{name, value}`. Library / shortcut: `{name:'key', value:'Space'}`. Focused desktop mode also emits DOM key codes and `{name:'click',value:{x,y}}` in canvas pixels. |
| `pause` | Boolean; suspend any work outside the supplied frame loop |

`time` is epoch seconds, shared across outputs. `date` is a JavaScript `Date`; use local formatting for clocks. `dt` is elapsed seconds capped at 0.1 on resumption. Use time-derived deterministic animation or a seeded simulation for spanning scenes; independent `Math.random()` calls will diverge across views.

The host mutes and loops videos. Spanning groups periodically align their videos with a shared wall-clock timeline; resuming or reconnecting jumps to the current group time. Independent live scenes avoid these synchronization seeks and resume their paused media. Synchronization is approximate (subsecond), not a shared decoder or frame-locked stream.

## Performance and execution boundaries

Use the host's `frame` callback so fullscreen / DPMS / user pause can stop your work. Independent timers, CSS animations, workers, or additional animation loops do not inherit this cooperative pause contract. Listen for `pause` to stop custom work. Cap canvas backing resolution, reuse buffers, and update clock DOM only when the displayed value changes. Still images should be imported as images to use the zero-animation native path.

In the original WebKit baseline, each active live output has its own webview and decoder; spanning does not share textures or simulation state. This is a prototype tradeoff. The daemon shares audio input and sends only compact level data; it does not move video pixels through Rust or encode desktop frames.

NVIDIA uses WebKit's compatibility renderer by default because its accelerated path stalled embedded video on the verified system. Live scenes therefore cost more CPU on that setup. Ordinary video files use a separate mpv hardware-decoding path. Prefer ordinary images/videos when no program is needed; reduce the live frame budget for quieter scenes. WebGL support depends on the installed WebKit/driver combination and was not part of this prototype's acceptance checks.

Only run local bundles you trust. Scenes have no native command bridge or UI token, use ephemeral web contexts, deny permission requests, and have a CSP that disables network connections, remote resources, frames, plugins, and form submission. Local HTML can still load local resources, and JavaScript is executable code. This is not an untrusted marketplace sandbox; origin isolation, asset brokering, resource quotas, and a signing/trust model must precede backend-delivered third-party bundles. Wallpaper Engine scene packages are not supported.

Scene errors, rendered frame counts, date, last signal, pointer/audio snapshots, and video readiness are visible in the CLI's `status` output. Replacing a scene terminates its dedicated web process.

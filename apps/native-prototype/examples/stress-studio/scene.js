"use strict";

const setup = globalThis.STRESS_STUDIO || { preset: "standard", media: false };
const workload = globalThis.STRESS_STUDIO_PRESETS[setup.preset];
if (!workload) throw new Error(`Unknown stress preset: ${setup.preset}`);
const canvas = document.getElementById("canvas");
canvas.width = wallpaper.canvas.width;
canvas.height = wallpaper.canvas.height;
const gl = canvas.getContext("webgl2", {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: false,
  powerPreference: "high-performance",
});
if (!gl) throw new Error("Stress studio requires WebGL2");
const rendererInfo = gl.getExtension("WEBGL_debug_renderer_info");
globalThis.__wallpaperSceneDiagnostics = Object.freeze({
  name: "Stress studio",
  preset: setup.preset,
  media: Boolean(setup.media),
  webgl_renderer: gl.getParameter(
    rendererInfo ? rendererInfo.UNMASKED_RENDERER_WEBGL : gl.RENDERER,
  ),
  webgl_vendor: gl.getParameter(
    rendererInfo ? rendererInfo.UNMASKED_VENDOR_WEBGL : gl.VENDOR,
  ),
  webgl_renderer_unmasked: Boolean(rendererInfo),
  canvas_width: gl.drawingBufferWidth,
  canvas_height: gl.drawingBufferHeight,
});

const prefix = `#version 300 es
precision highp float;
precision highp int;
in vec2 uv; out vec4 color;
uniform sampler2D mediaTexture;
uniform float time, audio, pulse;
uniform vec4 pointer, date, params;
uniform float bands[16];
uniform int hasMedia;
vec3 decodeSRGB(vec3 x) {
  return mix(x / 12.92, pow((x + .055) / 1.055, vec3(2.4)), step(vec3(.04045), x));
}
vec3 encodeSRGB(vec3 x) {
  return mix(x * 12.92, 1.055 * pow(max(x, vec3(0)), vec3(1.0 / 2.4)) - .055,
    step(vec3(.0031308), x));
}
vec3 mediaColor(vec2 p) { return decodeSRGB(texture(mediaTexture, p).rgb) * 203.0 / 80.0; }
`;
const vertex = `#version 300 es
out vec2 uv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  uv = p; gl_Position = vec4(p * 2.0 - 1.0, 0, 1);
}`;
function compile(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }
  return shader;
}
const program = gl.createProgram();
gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
gl.attachShader(
  program,
  compile(
    gl.FRAGMENT_SHADER,
    prefix +
      `#define STRESS_SEED ${workload[3].toFixed(1)}\n` +
      globalThis.STRESS_STUDIO_FRAGMENT +
      "\nvoid main() { color = vec4(encodeSRGB(studio(uv) * 80.0 / 203.0), 1.0); }",
  ),
);
gl.linkProgram(program);
if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
  throw new Error(gl.getProgramInfoLog(program));
}
gl.useProgram(program);
gl.bindVertexArray(gl.createVertexArray());
const uniforms = Object.fromEntries(
  [
    "time",
    "audio",
    "pulse",
    "pointer",
    "date",
    "params",
    "bands[0]",
    "hasMedia",
    "mediaTexture",
  ].map((name) => [name, gl.getUniformLocation(program, name)]),
);
gl.uniform4fv(uniforms.params, workload);
gl.uniform1i(uniforms.mediaTexture, 0);
const texture = gl.createTexture();
gl.activeTexture(gl.TEXTURE0);
gl.bindTexture(gl.TEXTURE_2D, texture);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.texImage2D(
  gl.TEXTURE_2D,
  0,
  gl.RGB,
  1,
  1,
  0,
  gl.RGB,
  gl.UNSIGNED_BYTE,
  new Uint8Array(3),
);

let video,
  videoDirty = false,
  mediaReady = false;
if (setup.media) {
  video = document.createElement("video");
  video.muted = true;
  video.loop = true;
  video.autoplay = true;
  video.playsInline = true;
  video.preload = "auto";
  video.style.display = "none";
  video.src = new URL(
    `${setup.assetPrefix || ""}background-4k.mp4`,
    document.baseURI,
  ).href;
  document.getElementById("scene").append(video);
  if (!video.requestVideoFrameCallback) {
    throw new Error(
      "The media comparison requires requestVideoFrameCallback to avoid duplicate uploads",
    );
  }
  video.addEventListener("loadedmetadata", () => {
    if (video.videoWidth !== 3840 || video.videoHeight !== 2160) {
      throw new Error("Stress media must be the generated 3840×2160 fixture");
    }
  });
  const decoded = () => {
    videoDirty = true;
    video.requestVideoFrameCallback(decoded);
  };
  video.requestVideoFrameCallback(decoded);
}

let pulse = 0;
const spectrum = new Float32Array(16);
const parameters = new Float32Array(workload);
wallpaper.on("signal", () => pulse++);
wallpaper.on("frame", (frame) => {
  parameters[3] = frame.time % 4096;
  gl.uniform4fv(uniforms.params, parameters);
  if (video && videoDirty && video.readyState >= 2) {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    if (mediaReady) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGB, gl.UNSIGNED_BYTE, video);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
    }
    mediaReady = true;
    videoDirty = false;
  }
  gl.uniform1i(uniforms.hasMedia, mediaReady ? 1 : 0);
  gl.uniform1f(uniforms.audio, frame.audio.rms);
  gl.uniform1f(uniforms.pulse, pulse);
  gl.uniform4f(uniforms.pointer, frame.pointer.x, frame.pointer.y, 0, 0);
  gl.uniform4f(
    uniforms.date,
    frame.date.getFullYear(),
    frame.date.getMonth() + 1,
    frame.date.getDate(),
    frame.date.getHours() * 3600 +
      frame.date.getMinutes() * 60 +
      frame.date.getSeconds(),
  );
  spectrum.set(frame.audio.bands);
  gl.uniform1fv(uniforms["bands[0]"], spectrum);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
});
canvas.addEventListener("webglcontextlost", () => {
  throw new Error(
    "Stress studio lost its WebGL context; this capture is invalid",
  );
});
console.info(
  `Stress studio: ${setup.preset}; steps/octaves/lights/seed=${workload}; media=${Boolean(setup.media)}; backing=${canvas.width}×${canvas.height}`,
);

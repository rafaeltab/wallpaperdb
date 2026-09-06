"use strict";

(() => {
  const inputs = globalThis.WDB_FIXED_HEAVY_INPUTS;
  const workload = globalThis.STRESS_STUDIO_PRESETS.heavy;
  if (
    workload
      .slice(0, 3)
      .some((value, index) => value !== inputs.params[index]) ||
    workload[3] !== inputs.seed[0] ||
    inputs.hasMedia[0] !== 0
  )
    throw new Error(
      "Fixed control input table does not match the shared heavy preset",
    );

  const seconds = inputs.date[3];
  const fixedDate = new Date(
    inputs.date[0],
    inputs.date[1] - 1,
    inputs.date[2],
    Math.floor(seconds / 3600),
    Math.floor(seconds / 60) % 60,
    seconds % 60,
  );
  const fixedFrame = Object.freeze({
    time: inputs.params[3],
    dt: 0,
    date: fixedDate,
    pointer: Object.freeze({
      x: inputs.pointer[0],
      y: inputs.pointer[1],
      inside: true,
    }),
    audio: Object.freeze({
      available: false,
      rms: inputs.audio[0],
      bands: inputs.bands.slice(),
    }),
  });
  const host = globalThis.wallpaper;
  let draws = 0;

  function verifyUniforms() {
    // Inspect existing program state once during warmup; no pixel readback.
    const gl = document.getElementById("canvas").getContext("webgl2");
    const program = gl.getParameter(gl.CURRENT_PROGRAM);
    const value = (name) => {
      const location = gl.getUniformLocation(program, name);
      if (location === null)
        throw new Error(`Fixed control uniform missing: ${name}`);
      const result = gl.getUniform(program, location);
      return typeof result === "number" ? [result] : Array.from(result);
    };
    const actual = {
      params: value("params"),
      pointer: value("pointer"),
      audio: value("audio"),
      pulse: value("pulse"),
      date: value("date"),
      hasMedia: value("hasMedia"),
      bands: inputs.bands.map((_, index) => value(`bands[${index}]`)[0]),
    };
    for (const [name, values] of Object.entries(actual)) {
      if (
        values.length !== inputs[name].length ||
        values.some((number, index) => number !== inputs[name][index])
      ) {
        throw new Error(`Fixed control uniform mismatch: ${name}=${values}`);
      }
    }
    const proof = Object.freeze({
      schema: 1,
      verified: true,
      method: "WebGL getUniform during warmup",
      draw: draws,
      inputs: actual,
      seed: inputs.seed[0],
      media: false,
      note: "Shader uniforms are fixed. Host telemetry may still report the live cursor and wall clock.",
    });
    globalThis.__wallpaperSceneDiagnostics = Object.freeze({
      ...globalThis.__wallpaperSceneDiagnostics,
      benchmark_only: true,
      fixed_control: proof,
    });
    console.info(`WDB_FIXED_HEAVY_INPUTS ${JSON.stringify(proof)}`);
  }

  // Keep the existing runtime scheduler and exact scene.js callback. The
  // callback still submits one draw on every host frame with constant uniforms.
  globalThis.wallpaper = Object.freeze({
    ...host,
    on(name, callback) {
      if (name === "signal") return () => {};
      if (name !== "frame") return host.on(name, callback);
      return host.on(name, () => {
        callback(fixedFrame);
        if (++draws === 2) verifyUniforms();
      });
    },
  });
})();

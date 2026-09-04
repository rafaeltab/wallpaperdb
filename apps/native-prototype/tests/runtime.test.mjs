import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function runtime() {
  const events = new Map(),
    reports = [];
  let scheduled = 0,
    cleared = 0;
  const video = {
    muted: false,
    duration: 8,
    currentTime: 0,
    paused: false,
    readyState: 4,
    addEventListener() {},
    play() {
      this.paused = false;
      return Promise.resolve();
    },
    pause() {
      this.paused = true;
    },
  };
  const context = {
    __WALLPAPER_CONFIG__: {
      fps: 30,
      canvas: { width: 3840, height: 1080 },
      viewport: { x: 1920, y: 0 },
      epoch: Date.now(),
    },
    performance: { now: () => 0 },
    Date,
    Map,
    Set,
    Object,
    Array,
    Math,
    Number,
    String,
    document: {
      querySelectorAll: () => [video],
      createElement: () => ({}),
      head: { append() {} },
    },
    setTimeout() {
      scheduled++;
      return scheduled;
    },
    clearTimeout() {
      cleared++;
    },
    requestAnimationFrame() {},
    addEventListener(name, fn) {
      events.set(name, fn);
    },
    webkit: {
      messageHandlers: {
        telemetry: { postMessage: (s) => reports.push(JSON.parse(s)) },
      },
    },
  };
  context.window = context;
  vm.runInNewContext(
    readFileSync(new URL("../runtime/wallpaper.js", import.meta.url), "utf8"),
    context,
  );
  return {
    context,
    events,
    reports,
    video,
    get scheduled() {
      return scheduled;
    },
    get cleared() {
      return cleared;
    },
  };
}
test("host pause stops scheduling and video, resume restarts both", () => {
  const r = runtime();
  r.events.get("DOMContentLoaded")();
  assert.equal(r.scheduled, 1);
  r.context.__wallpaperHost.update({ paused: true });
  assert.equal(r.video.paused, true);
  assert.equal(r.cleared, 1);
  r.context.__wallpaperHost.update({ paused: false });
  assert.equal(r.video.paused, false);
  assert.equal(r.scheduled, 2);
});
test("audio, pointer and keyboard reach executable scene callbacks", () => {
  const r = runtime();
  const received = [];
  for (const name of ["audio", "pointer", "signal"])
    r.context.wallpaper.on(name, (v) => received.push([name, v]));
  r.context.__wallpaperHost.update({
    audio: { rms: 0.4 },
    pointer: { x: 0.2, y: 0.8 },
  });
  r.events.get("keydown")({ code: "Space", repeat: false });
  assert.deepEqual(
    received.map((v) => v[0]),
    ["pointer", "audio", "signal"],
  );
  assert.equal(received[2][1].value, "Space");
  assert.equal(r.reports.at(-1).signals, 1);
});
test("a broken scene reports its error without breaking other listeners", () => {
  const r = runtime();
  let reached = false;
  r.context.wallpaper.on("signal", () => {
    throw new Error("scene failed");
  });
  r.context.wallpaper.on("signal", () => {
    reached = true;
  });
  r.context.__wallpaperHost.signal({ name: "key", value: "Space" });
  assert.equal(reached, true);
  assert.match(r.reports.at(-1).error, /scene failed/);
});
test("pointer clicks map into the full spanning canvas", () => {
  const r = runtime();
  r.events.get("pointerdown")({ clientX: 25, clientY: 30 });
  assert.equal(r.reports.at(-1).lastSignal.value.x, 1945);
  assert.equal(r.reports.at(-1).lastSignal.value.y, 30);
});

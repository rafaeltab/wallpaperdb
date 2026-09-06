import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function runtime() {
  const events = new Map(),
    reports = [],
    timers = new Map(),
    animationFrames = [];
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
    setTimeout(callback, delay) {
      scheduled++;
      timers.set(scheduled, { callback, delay });
      return scheduled;
    },
    clearTimeout(id) {
      cleared++;
      timers.delete(id);
    },
    requestAnimationFrame(callback) {
      animationFrames.push(callback);
    },
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
    timers,
    animationFrames,
    runTimer(id) {
      const timer = timers.get(id);
      timers.delete(id);
      timer.callback();
    },
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
  assert.equal(r.timers.size, 1);
  assert.equal([...r.timers.values()][0].delay, 1000);
  r.context.__wallpaperHost.update({ paused: false });
  assert.equal(r.video.paused, false);
  assert.equal(r.timers.size, 1);
  assert.ok([...r.timers.values()][0].delay < 1000);
});
test("paused heartbeat refreshes telemetry without scene events or animation callbacks", () => {
  const r = runtime();
  let sceneEvents = 0;
  r.context.wallpaper.on("frame", () => sceneEvents++);
  r.events.get("DOMContentLoaded")();
  r.context.__wallpaperHost.update({ paused: true });
  const pausedReport = r.reports.at(-1);
  const timerId = [...r.timers.keys()][0];
  r.context.__wallpaperHost.update({ paused: true });
  assert.deepEqual([...r.timers.keys()], [timerId]);
  r.video.currentTime = 2.5;
  r.runTimer(timerId);
  const heartbeat = r.reports.at(-1);
  assert.equal(heartbeat.report_sequence, pausedReport.report_sequence + 1);
  assert.equal(heartbeat.paused, true);
  assert.equal(heartbeat.videos[0].time, 2.5);
  assert.equal(heartbeat.frames, pausedReport.frames);
  assert.equal(sceneEvents, 0);
  assert.equal(r.animationFrames.length, 0);
  assert.equal(r.timers.size, 1);
  assert.equal([...r.timers.values()][0].delay, 1000);
});
test("resume cancels the paused heartbeat and a stale callback cannot restart it", () => {
  const r = runtime();
  r.events.get("DOMContentLoaded")();
  r.context.__wallpaperHost.update({ paused: true });
  const heartbeatId = [...r.timers.keys()][0];
  const staleCallback = r.timers.get(heartbeatId).callback;
  r.context.__wallpaperHost.update({ paused: false });
  const reports = r.reports.length;
  assert.equal(r.timers.has(heartbeatId), false);
  staleCallback();
  assert.equal(r.reports.length, reports);
  assert.equal(r.timers.size, 1);
  assert.ok([...r.timers.values()][0].delay < 1000);
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

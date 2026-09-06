(() => {
  "use strict";
  const config = window.__WALLPAPER_CONFIG__;
  const listeners = new Map();
  const state = {
    paused: false,
    pointer: { x: 0.5, y: 0.5, inside: false },
    audio: { available: false, rms: 0, bands: Array(16).fill(0) },
    signals: 0,
    lastSignal: null,
    frames: 0,
    fps: 0,
    error: null,
    intervals_ms: [],
  };
  function emit(name, value) {
    for (const fn of listeners.get(name) || []) {
      try {
        fn(value);
      } catch (error) {
        state.error = String(error);
      }
    }
  }
  let reportSequence = 0;
  function report() {
    const videos = [...document.querySelectorAll("video")].map((v) => {
      // These count displayed plus dropped video frames, not decoded frames:
      // https://w3c.github.io/media-playback-quality/
      let quality;
      try {
        quality = v.getVideoPlaybackQuality?.();
      } catch {}
      return {
        time: v.currentTime,
        duration: Number.isFinite(v.duration) ? v.duration : null,
        width: v.videoWidth,
        height: v.videoHeight,
        paused: v.paused,
        ready: v.readyState,
        error: v.error?.message || null,
        total_video_frames: quality?.totalVideoFrames ?? null,
        dropped_video_frames: quality?.droppedVideoFrames ?? null,
      };
    });
    window.webkit?.messageHandlers?.telemetry?.postMessage(
      JSON.stringify({
        ...state,
        report_sequence: ++reportSequence,
        date: new Date().toISOString(),
        videos,
        scene: window.__wallpaperSceneDiagnostics || null,
        canvas: config.canvas,
        viewport: config.viewport,
      }),
    );
    state.intervals_ms = [];
  }
  let timer,
    pausedReportTimer,
    last = performance.now(),
    measuredAt = last,
    frameCount = 0;
  function schedulePausedReport() {
    // This heartbeat observes state without emitting scene frame events. Its
    // paused-only 1 Hz cost remains part of the paused workload measurement.
    pausedReportTimer = setTimeout(() => {
      pausedReportTimer = undefined;
      if (!state.paused) return;
      report();
      schedulePausedReport();
    }, 1000);
  }
  function schedule() {
    timer = setTimeout(
      () => requestAnimationFrame(frame),
      Math.max(0, 1000 / config.fps - (performance.now() - last) - 8),
    );
  }
  function frame(now) {
    if (state.paused) return;
    if (now - last < 1000 / config.fps - 0.5) {
      requestAnimationFrame(frame);
      return;
    }
    const dt = Math.min((now - last) / 1000, 0.1);
    if (state.intervals_ms.length < 512) state.intervals_ms.push(now - last);
    last = now;
    state.frames++;
    frameCount++;
    emit("frame", {
      time: Date.now() / 1000,
      dt,
      date: new Date(),
      pointer: state.pointer,
      audio: state.audio,
    });
    if (now - measuredAt >= 1000) {
      state.fps = Math.round((frameCount * 1000) / (now - measuredAt));
      frameCount = 0;
      measuredAt = now;
      for (const video of document.querySelectorAll("video")) {
        // One wall-clock timeline for all members, also used after pause/hotplug.
        if (
          config.synchronize &&
          Number.isFinite(video.duration) &&
          video.duration > 0
        ) {
          const target = ((Date.now() - config.epoch) / 1000) % video.duration;
          if (Math.abs(video.currentTime - target) > 0.2)
            video.currentTime = target;
        }
      }
      report();
    }
    schedule();
  }
  window.wallpaper = Object.freeze({
    version: 1,
    canvas: config.canvas,
    viewport: config.viewport,
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
      return () => listeners.get(name).delete(fn);
    },
  });
  window.__wallpaperHost = {
    update(input) {
      if (input.pointer) {
        state.pointer = input.pointer;
        emit("pointer", state.pointer);
      }
      if (input.audio) {
        state.audio = input.audio;
        emit("audio", state.audio);
      }
      if (typeof input.paused === "boolean" && input.paused !== state.paused) {
        state.paused = input.paused;
        if (state.paused) state.fps = 0;
        clearTimeout(timer);
        if (pausedReportTimer !== undefined) {
          clearTimeout(pausedReportTimer);
          pausedReportTimer = undefined;
        }
        for (const video of document.querySelectorAll("video")) {
          if (state.paused) video.pause();
          else
            video.play().catch((e) => {
              state.error = String(e);
            });
        }
        emit("pause", state.paused);
        if (state.paused) schedulePausedReport();
        else {
          last = performance.now();
          measuredAt = last;
          frameCount = 0;
          schedule();
        }
        report();
      }
    },
    signal(event) {
      state.signals++;
      state.lastSignal = event;
      emit("signal", event);
      report();
    },
  };
  addEventListener("error", (event) => {
    state.error = event.message;
    report();
  });
  addEventListener("unhandledrejection", (event) => {
    state.error = String(event.reason);
    report();
  });
  addEventListener("keydown", (event) => {
    if (!event.repeat)
      window.__wallpaperHost.signal({ name: "key", value: event.code });
  });
  addEventListener("pointerdown", (event) => {
    window.__wallpaperHost.signal({
      name: "click",
      value: {
        x: event.clientX + config.viewport.x,
        y: event.clientY + config.viewport.y,
      },
    });
  });
  addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.textContent = `html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#080a12}#scene{position:absolute!important;left:${-config.viewport.x}px!important;top:${-config.viewport.y}px!important;width:${config.canvas.width}px!important;height:${config.canvas.height}px!important;overflow:hidden}`;
    document.head.append(style);
    for (const video of document.querySelectorAll("video")) {
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.addEventListener("error", () => {
        state.error = video.error?.message || "Video decoder failed";
        report();
      });
      video.addEventListener("loadedmetadata", () => {
        if (
          config.synchronize &&
          Number.isFinite(video.duration) &&
          video.duration > 0
        )
          video.currentTime =
            ((Date.now() - config.epoch) / 1000) % video.duration;
        if (!state.paused)
          video.play().catch((e) => {
            state.error = String(e);
            report();
          });
      });
      if (!state.paused)
        video.play().catch((e) => {
          state.error = String(e);
          report();
        });
    }
    emit("ready", config);
    schedule();
    report();
  });
})();

// Isolated diagnostic only: never loaded by the comparison renderer.
const { app, contentTracing } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

module.exports = function diagnostic(transport, stop) {
  const directory = process.env.WDB_CHROMIUM_DIAG_DIR;
  const seconds = Number(process.env.WDB_CHROMIUM_DIAG_SECONDS || 12);
  if (
    !directory ||
    !path.isAbsolute(directory) ||
    !(seconds >= 1 && seconds <= 15)
  )
    throw new Error(
      "Use the explicit isolated diagnostic runner (1–15 seconds)",
    );

  const capacity = 32768,
    columns = 5;
  const rows = new Float64Array(capacity * columns); // 1.25 MiB; never grows.
  const codes = {
    paint: 1,
    bitmap: 2,
    write: 3,
    submit: 4,
    poll: 5,
    ack: 6,
    paint_total: 7,
  };
  const counts = Object.fromEntries(
    Object.keys(codes).map((key) => [
      key,
      { count: 0, total_us: 0, max_us: 0 },
    ]),
  );
  const clock = () => Number(process.hrtime.bigint()) / 1000;
  const inFlight = new Map(); // Existing transport has two reusable buffers.
  let active = false,
    finishing = false,
    count = 0,
    overflow = 0,
    currentId = 0;
  let helper,
    window,
    timer,
    metricsTimer,
    usagePending = false;
  const metrics = [],
    bufferUsage = [],
    errors = [];
  const metadata = {
    diagnostic_only: true,
    version: 1,
    seconds_requested: seconds,
    warmup_seconds: 2,
    trace_buffer_kib: 32768,
    js_event_buffer_bytes: rows.byteLength,
    event_codes: codes,
    clock:
      "process.hrtime.bigint microseconds; correlate cross-process stages by frame ID, not an assumed epoch",
    limitations: [
      "toBitmap measures NativeImage extraction/copy after paint delivery; GPU readback may have happened before this callback.",
      "Paint entry, submit and acknowledgement counters do not establish one paint per WebGL callback.",
      "This instrumented trace is not a comparison capture or a low-overhead FPS measurement.",
      "Chromium record-until-full may retain only the start of the interval; inspect buffer usage and trace loss metadata.",
      "Electron process CPU fields retain the API's native units and sampling windows; the first CPU sample is baseline only.",
    ],
    versions: process.versions,
    pid: process.pid,
  };
  function mark(name, id, began, value = 0) {
    if (!active) return;
    const ended = clock(),
      duration = Math.max(0, ended - began);
    const stats = counts[name];
    stats.count++;
    stats.total_us += duration;
    stats.max_us = Math.max(stats.max_us, duration);
    if (count === capacity) {
      overflow++;
      return;
    }
    const index = count++ * columns;
    rows[index] = codes[name];
    rows[index + 1] = id;
    rows[index + 2] = began;
    rows[index + 3] = duration;
    rows[index + 4] = value;
  }
  function snapshot() {
    if (metrics.length >= 22) return;
    try {
      metrics.push({
        at_us: clock(),
        baseline: metrics.length === 0,
        processes: app
          .getAppMetrics()
          .slice(0, 64)
          .map((metric) => ({
            pid: metric.pid,
            type: metric.type,
            name: metric.name,
            serviceName: metric.serviceName,
            creationTime: metric.creationTime,
            cpu: metric.cpu,
            memory: metric.memory,
          })),
      });
    } catch (error) {
      errors.push(String(error));
    }
  }
  function writeEvents() {
    const fd = fs.openSync(
      path.join(directory, "producer-stages.csv"),
      "wx",
      0o600,
    );
    try {
      fs.writeSync(fd, "stage,id,at_us,duration_us,value\n");
      // Serialization occurs after recording stops. No per-frame file I/O is added.
      for (let offset = 0; offset < count; offset += 512) {
        let text = "";
        for (let i = offset; i < Math.min(count, offset + 512); i++) {
          const at = i * columns;
          text += Array.from(rows.subarray(at, at + columns)).join(",") + "\n";
        }
        fs.writeSync(fd, text);
      }
    } finally {
      fs.closeSync(fd);
    }
  }
  async function finish(reason) {
    if (finishing) return;
    finishing = true;
    active = false;
    clearTimeout(timer);
    clearInterval(metricsTimer);
    metadata.stop_requested_us = clock();
    metadata.stop_reason = reason;
    window?.webContents.stopPainting();
    helper?.stdin.write('{"diagnostic_trace":false,"paused":true}\n');
    snapshot();
    try {
      metadata.trace_path = path.basename(
        await contentTracing.stopRecording(
          path.join(directory, "chromium-trace.json"),
        ),
      );
      metadata.trace_flushed = true;
    } catch (error) {
      errors.push(String(error));
    }
    try {
      writeEvents();
      fs.writeFileSync(
        path.join(directory, "producer-diagnostic.json"),
        JSON.stringify(
          {
            ...metadata,
            rows: count,
            overflow,
            counters: counts,
            metrics,
            bufferUsage,
            errors,
          },
          null,
          2,
        ) + "\n",
        { flag: "wx", mode: 0o600 },
      );
    } finally {
      stop();
    }
  }
  return {
    paint(nextId, callback) {
      return (event, dirty, image) => {
        if (!active) return callback(event, dirty, image);
        const began = clock();
        currentId = nextId();
        mark("paint", currentId, began);
        try {
          return callback(event, dirty, image);
        } finally {
          mark("paint_total", currentId, began);
          currentId = 0;
        }
      };
    },
    bitmap(image) {
      if (!active) return image.toBitmap();
      const began = clock();
      try {
        return image.toBitmap();
      } finally {
        mark("bitmap", currentId, began);
      }
    },
    write(fd, buffer) {
      if (!active) return fs.writeSync(fd, buffer, 0, buffer.length, 0);
      const began = clock();
      try {
        return fs.writeSync(fd, buffer, 0, buffer.length, 0);
      } finally {
        mark("write", currentId, began, buffer.length);
      }
    },
    submit(fd, text, fds) {
      if (!active) return transport.submit(fd, text, fds);
      const id = JSON.parse(text).id,
        began = clock();
      const accepted = transport.submit(fd, text, fds);
      mark("submit", id, began, accepted ? 1 : 0);
      if (accepted) inFlight.set(id, began);
      return accepted;
    },
    poll(fd) {
      if (!active) return transport.poll(fd);
      const began = clock(),
        ids = transport.poll(fd);
      mark("poll", currentId, began, ids.length);
      for (const id of ids) {
        const sent = inFlight.get(id);
        if (sent !== undefined) mark("ack", id, sent);
        inFlight.delete(id);
      }
      return ids;
    },
    async start(win, presenter) {
      window = win;
      helper = presenter;
      metadata.renderer_os_pid = win.webContents.getOSProcessId();
      metadata.presenter_pid = presenter.pid;
      metadata.producer_fps = win.webContents.getFrameRate();
      metadata.anchor = { hrtime_us: clock(), unix_epoch_ms: Date.now() };
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const wanted = [
        "electron",
        "toplevel",
        "cc",
        "viz",
        "gpu",
        "gpu_toplevel",
        "renderer.scheduler",
        "blink",
        "blink.user_timing",
        "v8",
        "devtools.timeline",
        "disabled-by-default-gpu.service",
      ];
      const available = await contentTracing.getCategories();
      const observed = new Set(available.flatMap((group) => group.split(",")));
      const categories = wanted.filter((category) => observed.has(category));
      if (!categories.length)
        throw new Error("No requested Chromium trace categories available");
      metadata.categories = categories;
      metadata.unavailable_categories = wanted.filter(
        (category) => !observed.has(category),
      );
      snapshot();
      metadata.start_requested_us = clock();
      // Start the timer before awaiting child acknowledgements: startup is in-budget.
      timer = setTimeout(() => {
        void finish("duration");
      }, seconds * 1000);
      await contentTracing.startRecording({
        recording_mode: "record-until-full",
        trace_buffer_size_in_kb: 32768,
        included_categories: categories,
        excluded_categories: ["*"],
        enable_argument_filter: true,
      });
      if (finishing) return;
      metadata.start_acknowledged_us = clock();
      active = true;
      helper.stdin.write('{"diagnostic_trace":true}\n');
      metricsTimer = setInterval(() => {
        snapshot();
        if (!usagePending && bufferUsage.length < 22) {
          usagePending = true;
          contentTracing
            .getTraceBufferUsage()
            .then((value) => {
              bufferUsage.push({ at_us: clock(), ...value });
            })
            .catch((error) => errors.push(String(error)))
            .finally(() => {
              usagePending = false;
            });
        }
      }, 1000);
    },
  };
};

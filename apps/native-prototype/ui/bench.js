"use strict";
(() => {
  let result = null,
    record = null,
    viewedId = null,
    loadedFinal = null;
  let wasActive = false,
    polling = false,
    lastSequence = null,
    lastHistory = 0;
  let actionPending = null;
  const active = () => Boolean(state.benchmark?.active);
  const number = (n, digits = 1) =>
    Number.isFinite(n) ? n.toFixed(digits) : "—";
  const manual = (request) => request?.mode === "manual";
  const stateLabel = (status) =>
    ({
      complete: "Comparison complete",
      stopped: "Recording saved · desktop restored",
      cancelled: "Cancelled · desktop restored",
      failed: "Benchmark failed",
      interrupted: "Interrupted",
    })[status.state] ||
    status.phase ||
    "Starting benchmark";
  function modeOptions() {
    const continuous = $("bench-mode").value === "manual";
    for (const id of ["bench-seconds", "bench-repeats", "bench-demo"]) {
      $(id).disabled = continuous || active();
      $(id).closest("label").hidden = continuous;
    }
    $("bench-replay-explanation").hidden = continuous;
    $("bench-mode-description").textContent = continuous
      ? "One offline gameplay session. Start control recording when ready, switch to wallpaper recording, then Stop and save. Each phase can be as long as you like; their durations may differ."
      : "Repeat the same local replay with and without your wallpaper. Loading and warmup are excluded; complete pairs produce the comparison.";
    $("bench-start").textContent = continuous
      ? "Open gameplay session ↗"
      : "Start comparison ↗";
    $("bench-estimate").textContent = continuous
      ? "Runs until you stop · PC stays awake"
      : "A few minutes · results stay on this device";
  }
  function displayWarning() {
    const same =
      Boolean(state.ui_output) && $("bench-output").value === state.ui_output;
    $("bench-display-warning").hidden = !same;
    $("bench-display-warning").textContent = same
      ? `The library is on ${state.ui_output}, the same display as the game. You may not see the live graph or Stop button while playing. Switch back to this workspace to use them, or choose another game display. The library will stay here.`
      : "";
  }
  function open() {
    if (active()) return openRecord(state.benchmark.id);
    const item = state.items.find((item) => item.id === selected);
    $("bench-selection").textContent = [
      item?.title || "Choose a wallpaper",
      $("experiment").selectedOptions[0].textContent.trim(),
      [...outputs].join(" + "),
      $("fps").value + " fps budget",
    ].join(" · ");
    const connected = state.monitors.filter((monitor) => !monitor.disabled);
    const previous = $("bench-output").value;
    $("bench-output").replaceChildren(
      ...connected.map(
        (m) => new Option(m.name + " · " + m.width + " × " + m.height, m.name),
      ),
    );
    $("bench-output").value = connected.some((m) => m.name === previous)
      ? previous
      : (connected.find((m) => m.name !== state.ui_output) || connected[0])
          ?.name || "";
    $("bench-setup-error").textContent = "";
    if (!$("bench-browser").open) $("bench-dialog").showModal();
    modeOptions();
    displayWarning();
    refresh(state);
  }
  $("bench").onclick = open;
  $("bench-nav").onclick = showHistory;
  $("bench-close").onclick = () => $("bench-dialog").close();
  $("bench-browser-close").onclick = () => $("bench-browser").close();
  $("bench-mode").onchange = modeOptions;
  $("bench-output").onchange = displayWarning;
  $("bench-back").onclick = showHistory;
  $("bench-parameters-toggle").onclick = () => {
    $("bench-parameters").hidden = !$("bench-parameters").hidden;
    $("bench-parameters-toggle").setAttribute(
      "aria-expanded",
      String(!$("bench-parameters").hidden),
    );
    $("bench-parameters-toggle").textContent = $("bench-parameters").hidden
      ? "View parameters"
      : "Hide parameters";
  };
  $("bench-form").onsubmit = async (event) => {
    event.preventDefault();
    if (active()) return;
    $("bench-start").disabled = true;
    $("bench-setup-error").textContent = "";
    try {
      const next = await api({
        op: "bench_start",
        mode: $("bench-mode").value,
        game: "cs2",
        source: selected,
        outputs: [...outputs],
        span,
        experiment: $("experiment").value,
        fps: Number($("fps").value),
        hdr: $("hdr").checked,
        audio: $("audio").checked,
        game_output: $("bench-output").value,
        cap: Number($("bench-cap").value),
        preset: $("bench-preset").value,
        cpu_temperature_check: $("bench-cpu-temperature-check").checked,
        seconds: Number($("bench-seconds").value),
        repeats: Number($("bench-repeats").value),
        policy: $("bench-policy").value,
        resolution: $("bench-resolution").value,
        demo:
          $("bench-mode").value === "manual"
            ? ""
            : $("bench-demo").value.trim(),
      });
      update(next);
      $("bench-dialog").close();
      await openRecord(next.benchmark.id);
    } catch (failure) {
      $("bench-setup-error").textContent = failure.message;
      $("bench-start").disabled = false;
    }
  };
  async function action(op) {
    if (actionPending) return;
    actionPending = record?.status?.phase;
    for (const id of ["bench-next", "bench-stop", "bench-cancel"])
      $(id).disabled = true;
    try {
      update(await api({ op }));
      await poll();
    } catch (failure) {
      actionPending = null;
      error(failure);
    }
  }
  $("bench-cancel").onclick = () => action("bench_cancel");
  $("bench-stop").onclick = () => action("bench_stop");
  $("bench-next").onclick = () => action("bench_next");
  function summaryText(entry) {
    const r = entry.request;
    return [
      "Counter-Strike 2",
      manual(r)
        ? "Continuous gameplay"
        : `${r.repeats} pair${r.repeats === 1 ? "" : "s"} · ${r.seconds}s replay`,
      `${r.experiment} · ${r.fps} wallpaper fps`,
      `Game: ${r.game_output}`,
      `Wallpaper: ${(r.outputs || []).join(" + ")}${r.span ? " spanning" : ""}`,
      `${r.preset} graphics`,
      r.cap ? `${r.cap} game fps` : "Game uncapped",
      r.policy === "active" ? "Wallpaper stays active" : "Fullscreen pause",
      `CPU temperature check ${r.cpu_temperature_check === false ? "off" : "on"}`,
    ].join(" · ");
  }
  async function showHistory() {
    viewedId = null;
    result = record = null;
    loadedFinal = null;
    lastSequence = null;
    $("bench-detail").hidden = true;
    $("bench-history").hidden = false;
    $("bench-browser-title").textContent = "Benchmarks";
    if (!$("bench-browser").open) $("bench-browser").showModal();
    await loadHistory();
  }
  async function loadHistory() {
    try {
      const { benchmarks } = await api({ op: "bench_history" });
      if (viewedId) return;
      lastHistory = Date.now();
      $("bench-history-empty").hidden = benchmarks.length > 0;
      $("bench-history-list").replaceChildren(
        ...benchmarks.map((entry) => {
          const button = document.createElement("button");
          button.className = "bench-history-card";
          button.dataset.id = entry.id;
          const title = document.createElement("strong"),
            summary = document.createElement("span"),
            status = document.createElement("span");
          title.textContent = entry.wallpaper?.title || entry.request.source;
          summary.textContent = summaryText(entry);
          status.className = "bench-history-state";
          status.textContent = `${new Date(entry.created_ms).toLocaleString()} · ${stateLabel(entry.status)}`;
          button.append(title, summary, status);
          button.onclick = () => openRecord(entry.id);
          return button;
        }),
      );
    } catch (failure) {
      error(failure);
    }
  }
  async function openRecord(id) {
    viewedId = id;
    loadedFinal = null;
    lastSequence = null;
    actionPending = null;
    result = record = null;
    $("bench-history").hidden = true;
    $("bench-detail").hidden = false;
    $("bench-results").hidden = true;
    $("bench-progress").hidden = false;
    $("bench-phase").textContent = "Opening benchmark…";
    $("bench-parameters").hidden = true;
    $("bench-parameters-toggle").textContent = "View parameters";
    $("bench-parameters-toggle").setAttribute("aria-expanded", "false");
    if (!$("bench-browser").open) $("bench-browser").showModal();
    await poll(true);
  }
  function parameters() {
    const r = record.request;
    const labels = {
      mode: "Recording mode",
      game: "Game",
      source: "Wallpaper ID",
      outputs: "Wallpaper displays",
      span: "Span displays",
      experiment: "Renderer",
      fps: "Wallpaper frame budget",
      hdr: "HDR requested",
      audio: "Wallpaper audio",
      game_output: "Game display",
      cap: "Game frame limit",
      preset: "Graphics preset",
      cpu_temperature_check: "CPU temperature check",
      seconds: "Replay seconds",
      repeats: "Replay pairs",
      policy: "Fullscreen policy",
      resolution: "Resolution choice",
      demo: "Replay path",
      id: "Benchmark ID",
    };
    const request = { mode: "comparison", cpu_temperature_check: true, ...r };
    $("bench-parameter-list").replaceChildren(
      ...Object.entries(request)
        .filter(
          ([k]) => !manual(r) || !["seconds", "repeats", "demo"].includes(k),
        )
        .flatMap(([key, value]) => {
          const term = document.createElement("dt"),
            description = document.createElement("dd");
          term.textContent = labels[key] || key;
          description.textContent =
            typeof value === "boolean"
              ? value
                ? "On"
                : "Off"
              : Array.isArray(value)
                ? value.join(" + ")
                : value === ""
                  ? "Automatic"
                  : String(value);
          return [term, description];
        }),
    );
  }
  function showStatus() {
    const job = record.status;
    const running = job.active === true;
    if (actionPending && (!running || job.phase !== actionPending))
      actionPending = null;
    $("bench-browser-title").textContent =
      record.wallpaper?.title || "Benchmark results";
    $("bench-phase").textContent = stateLabel(job);
    if (running && job.recording && job.state === "running")
      $("bench-progress").dataset.recording = job.recording;
    else delete $("bench-progress").dataset.recording;
    $("bench-message").textContent =
      job.error ||
      job.message ||
      (job.wallpapers_restored
        ? "Your wallpaper assignments have been restored."
        : "");
    $("bench-step").textContent = manual(record.request)
      ? (job.recording ? "LIVE · " : "") +
        (result?.runs?.find((r) => r.provisional)?.wall_seconds
          ? number(result.runs.find((r) => r.provisional).wall_seconds, 1) +
            " s captured"
          : "")
      : `${job.completed || 0} / ${job.total || 1}`;
    $("bench-bar").hidden = manual(record.request);
    $("bench-bar").max = job.total || 1;
    $("bench-bar").value = job.completed || 0;
    $("bench-next").hidden =
      !running || !manual(record.request) || !job.can_next;
    $("bench-next").textContent =
      job.recording === "control"
        ? "Record wallpaper benchmark →"
        : "Start control recording";
    $("bench-stop").hidden = $("bench-cancel").hidden = !running;
    for (const id of ["bench-next", "bench-stop", "bench-cancel"])
      $(id).disabled =
        Boolean(actionPending) ||
        ["restoring", "cancelling", "stopping"].includes(job.state);
  }
  async function poll(force = false) {
    if (polling || !viewedId || !$("bench-browser").open) return;
    const id = viewedId;
    const running = state.benchmark?.id === id && active();
    if (!force && !running && loadedFinal === id) return;
    polling = true;
    try {
      const next = await api({
        op: running && !force ? "bench_live" : "bench_record",
        id,
      });
      if (id !== viewedId) return;
      record = next;
      const value = next.result || next.live;
      if (!next.status.active && (!running || next.result)) loadedFinal = id;
      const sequence = next.result ? "final" : value?.sequence;
      if (value && (lastSequence !== sequence || force)) {
        result = value;
        lastSequence = sequence;
        showResult();
      }
      if (!result) $("bench-results").hidden = true;
      parameters();
      showStatus();
    } catch (failure) {
      if (viewedId === id) $("bench-message").textContent = failure.message;
    } finally {
      polling = false;
    }
  }
  function refresh(next) {
    const running = Boolean(next.benchmark?.active);
    if (running !== wasActive) {
      wasActive = running;
      detail();
    }
    for (const control of $("bench-form").querySelectorAll("input,select"))
      control.disabled = running;
    $("bench-start").disabled =
      running || !selected || !outputs.size || Boolean(next.graphics_fault);
    if (next.graphics_fault)
      $("bench-setup-error").textContent =
        "Bench is paused for this graphics session after a GPU driver fault. Your saved recordings remain available.";
    for (const id of [
      "apply",
      "clear",
      "import",
      "import-bundle",
      "pause",
      "pulse",
    ]) {
      if (running) $(id).disabled = true;
      else if (["clear", "import", "import-bundle"].includes(id))
        $(id).disabled = false;
    }
    $("bench-nav").classList.toggle("bench-running", running);
    modeOptions();
    displayWarning();
    if (viewedId) poll();
    else if ($("bench-browser").open && Date.now() - lastHistory > 10000)
      loadHistory();
  }
  window.updateBench = refresh;
  setInterval(() => {
    if (!document.hidden) poll();
  }, 1000);
  function showResult() {
    $("bench-results").hidden = false;
    const change = result.comparison?.median_fps_change_percent;
    $("bench-verdict").textContent = result.invalidated
      ? "Invalid recording · excluded from comparisons"
      : Number.isFinite(change)
        ? `${change >= 0 ? "+" : ""}${number(change)}% FPS · ${result.comparison.median_p99_change_ms >= 0 ? "+" : ""}${number(result.comparison.median_p99_change_ms, 2)} ms p99`
        : result.runs.length
          ? record.status.active
            ? "Recording measurements"
            : "Measurements saved · no complete pair"
          : record.status.active
            ? "Waiting for measured frames"
            : "No measured frames were saved";
    $("bench-result-label").textContent = record.status.active
      ? "LIVE RECORDING"
      : "SAVED RECORDING";
    $("bench-result-context").textContent =
      summaryText(record) +
      (result.actual_resolution
        ? " · Observed " + result.actual_resolution.join(" × ")
        : result.requested_resolution
          ? " · Requested " + result.requested_resolution.join(" × ")
          : "");
    $("bench-live-note").textContent = [
      record.status.active
        ? "Graphs update about once per second as frame data arrives. Live summaries are provisional."
        : "",
      manual(record.request)
        ? "Control and wallpaper are separate parts of one gameplay session and can have different lengths. Gameplay differences affect this comparison."
        : "Only completed, validated pairs contribute to the FPS comparison.",
      !record.status.active && !record.result && record.live
        ? "This interrupted run has a provisional preview; it is not a validated result."
        : "",
      result.invalidated?.reason || "",
    ]
      .filter(Boolean)
      .join(" ");
    const body = $("bench-table").querySelector("tbody");
    body.replaceChildren(
      ...result.runs
        .filter((run) => run.summary)
        .map((run) => {
          const row = document.createElement("tr");
          [
            run.repeat +
              " · " +
              (run.condition === "control" ? "Control" : "Wallpaper") +
              (run.provisional
                ? " · live"
                : run.valid === false
                  ? " · excluded"
                  : ""),
            number(run.summary.average_fps),
            number(run.summary.low_1_percent_fps),
            number(run.summary.p99_ms, 2) + " ms",
            number(run.summary.worst_ms, 2) + " ms",
            run.summary.over_50ms,
            number(run.wall_seconds, 1) + " s",
          ].forEach((value, index) => {
            const cell = document.createElement(index ? "td" : "th");
            cell.textContent = value;
            row.append(cell);
          });
          return row;
        }),
    );
    const repeats = [...new Set(result.runs.map((run) => run.repeat))];
    const previous = Number($("bench-pair").value);
    $("bench-pair").replaceChildren(
      ...repeats.map((repeat) => new Option(repeat, repeat)),
    );
    if (repeats.includes(previous)) $("bench-pair").value = previous;
    else if (repeats.length) $("bench-pair").value = repeats.at(-1);
    $("bench-axis").querySelector('[value="scene_s"]').disabled = manual(
      record.request,
    );
    if (manual(record.request)) $("bench-axis").value = "time_s";
    $("bench-export").disabled = !record.result;
    $("bench-evidence").textContent = JSON.stringify(
      {
        ...result,
        runs: result.runs.map(({ plot, resources, ...run }) => run),
      },
      null,
      2,
    );
    draw();
  }
  function chart(id, datasets, maxY, value) {
    const canvas = $(id),
      context = canvas.getContext("2d"),
      ratio = window.devicePixelRatio || 1;
    const width = Math.max(canvas.clientWidth, 400),
      height = canvas.clientHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.scale(ratio, ratio);
    const left = 48,
      top = 12,
      graphWidth = width - left - 16,
      graphHeight = height - top - 28;
    const axis = $("bench-axis").value;
    const cpu =
      id === "bench-resources" &&
      $("bench-metric").value === "game_cpu_one_core_percent";
    const xValue = (row) =>
      (cpu ? row["cpu_" + axis] : row[axis]) ?? row[axis] ?? row.time_s;
    const maxTime = Math.max(
      1,
      ...datasets.flatMap(({ rows }) => rows.map(xValue)),
    );
    context.font = "11px system-ui";
    context.lineWidth = 1;
    for (let index = 0; index <= 4; index++) {
      const y = top + (graphHeight * index) / 4;
      context.strokeStyle = "#ffffff14";
      context.beginPath();
      context.moveTo(left, y);
      context.lineTo(width - 16, y);
      context.stroke();
      context.fillStyle = "#a79da5";
      context.fillText(number(maxY * (1 - index / 4), 0), 5, y + 4);
    }
    for (const { rows, color } of datasets) {
      context.strokeStyle = color;
      context.lineWidth = 1.3;
      context.beginPath();
      rows.forEach((row, index) => {
        const x = left + (xValue(row) / maxTime) * graphWidth,
          y = top + graphHeight * (1 - value(row) / maxY);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
    }
    context.fillStyle = "#a79da5";
    context.fillText(
      axis === "scene_s" ? "Replay seconds" : "Capture seconds",
      left,
      height - 5,
    );
    context.fillText(number(maxTime) + " s", width - 56, height - 5);
    canvas.onmousemove = (event) => {
      if (id !== "bench-frames") return;
      const t = Math.max(
        0,
        Math.min(maxTime, ((event.offsetX - left) / graphWidth) * maxTime),
      );
      $("bench-hover").textContent =
        number(t, 2) +
        " s · " +
        datasets
          .map(({ rows, label }) => {
            const row = rows.reduce(
              (best, row) =>
                !best || Math.abs(xValue(row) - t) < Math.abs(xValue(best) - t)
                  ? row
                  : best,
              null,
            );
            return row
              ? label +
                  ": " +
                  number(row.min_ms, 2) +
                  "–" +
                  number(row.max_ms, 2) +
                  " ms (" +
                  row.count +
                  " frames)"
              : label + ": no data";
          })
          .join(" · ");
    };
  }
  function draw() {
    if (!result || !$("bench-browser").open) return;
    const runs = result.runs.filter(
      (run) => run.repeat === Number($("bench-pair").value),
    );
    const colors = { control: "#8aadd0", wallpaper: "#ef8aa8" };
    const datasets = runs.map((run) => ({
      rows: run.plot,
      color: colors[run.condition],
      label: run.condition,
    }));
    chart(
      "bench-frames",
      datasets,
      Math.max(
        16.67,
        ...runs.flatMap((run) => run.plot.map((row) => row.max_ms)),
      ) * 1.05,
      (row) => row.max_ms,
    );
    const metric = $("bench-metric").value;
    chart(
      "bench-resources",
      runs.map((run) => ({
        rows: run.resources.filter((row) => Number.isFinite(row[metric])),
        color: colors[run.condition],
      })),
      metric === "gpu_percent"
        ? 100
        : Math.max(
            1,
            ...runs.flatMap((run) =>
              run.resources.map((row) => row[metric] || 0),
            ),
          ) * 1.05,
      (row) => row[metric],
    );
  }
  $("bench-pair").onchange = draw;
  $("bench-axis").onchange = draw;
  $("bench-metric").onchange = draw;
  $("bench-export").onclick = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = result.id + ".json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  window.addEventListener("resize", draw);
})();

"use strict";
(() => {
  let result = null;
  let loadedJob = null;
  let wasActive = false;
  const active = () => Boolean(state.benchmark?.active);
  const number = (n, digits = 1) =>
    Number.isFinite(n) ? n.toFixed(digits) : "—";
  function open() {
    const item = state.items.find((item) => item.id === selected);
    $("bench-selection").textContent = [
      item?.title || "Choose a wallpaper",
      $("experiment").selectedOptions[0].textContent.trim(),
      [...outputs].join(" + "),
      $("fps").value + " fps budget",
    ].join(" · ");
    if (!active()) {
      const connected = state.monitors.filter((monitor) => !monitor.disabled);
      const previous = $("bench-output").value;
      $("bench-output").replaceChildren(
        ...connected.map(
          (monitor) =>
            new Option(
              monitor.name + " · " + monitor.width + " × " + monitor.height,
              monitor.name,
            ),
        ),
      );
      $("bench-output").value = connected.some((m) => m.name === previous)
        ? previous
        : (connected.find((m) => m.name === "DP-5") || connected[0])?.name ||
          "";
    }
    if (!$("bench-dialog").open) $("bench-dialog").showModal();
    refresh(state);
    draw();
  }
  $("bench").onclick = open;
  $("bench-nav").onclick = open;
  $("bench-close").onclick = () => $("bench-dialog").close();
  $("bench-form").onsubmit = async (event) => {
    event.preventDefault();
    if (active()) return;
    $("bench-start").disabled = true;
    result = null;
    loadedJob = null;
    $("bench-results").hidden = true;
    try {
      update(
        await api({
          op: "bench_start",
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
          demo: $("bench-demo").value.trim(),
        }),
      );
    } catch (failure) {
      $("bench-progress").hidden = false;
      $("bench-phase").textContent = "Could not start";
      $("bench-message").textContent = failure.message;
      $("bench-start").disabled = false;
    }
  };
  $("bench-cancel").onclick = async () => {
    try {
      update(await api({ op: "bench_cancel" }));
    } catch (failure) {
      error(failure);
    }
  };
  async function refresh(next) {
    const job = next.benchmark || { state: "idle" };
    const running = Boolean(job.active);
    if (running !== wasActive) {
      wasActive = running;
      detail();
    }
    for (const control of $("bench-form").querySelectorAll("input,select"))
      control.disabled = running;
    $("bench-start").disabled = running || !selected || !outputs.size;
    $("bench-cancel").hidden = !running;
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
    if (job.state !== "idle") {
      $("bench-progress").hidden = false;
      $("bench-phase").textContent =
        {
          complete: "Comparison complete",
          cancelled: "Cancelled · desktop restored",
          failed: "Comparison failed",
        }[job.state] ||
        job.phase ||
        "Starting";
      $("bench-step").textContent =
        job.total > 1 ? (job.completed || 0) + " / " + job.total : "";
      $("bench-bar").max = job.total || 1;
      $("bench-bar").value =
        job.state === "complete" ? job.total || 1 : job.completed || 0;
      $("bench-message").textContent =
        job.error ||
        job.message ||
        (job.wallpapers_restored
          ? "Your wallpaper assignments have been restored."
          : "");
    }
    if (!running && job.state === "complete" && job.id !== loadedJob) {
      loadedJob = job.id;
      try {
        result = await api({ op: "bench_result" });
        showResult();
      } catch (failure) {
        loadedJob = null;
        $("bench-message").textContent = failure.message;
      }
    }
  }
  window.updateBench = refresh;
  function showResult() {
    $("bench-results").hidden = false;
    const change = result.comparison.median_fps_change_percent;
    $("bench-verdict").textContent =
      (change >= 0 ? "+" : "") +
      number(change) +
      "% FPS · " +
      (result.comparison.median_p99_change_ms >= 0 ? "+" : "") +
      number(result.comparison.median_p99_change_ms, 2) +
      " ms p99";
    $("bench-result-context").textContent = [
      result.wallpaper?.title ||
        state.items.find((item) => item.id === result.request.source)?.title ||
        "Selected wallpaper",
      result.request.experiment,
      result.request.outputs.join(" + ") +
        (result.request.span ? " spanning" : ""),
      result.game.platform,
      result.game.proton_name || "native Linux",
      result.actual_resolution.join(" × "),
      result.request.cap
        ? result.request.cap + " fps limit requested"
        : "uncapped requested",
      result.runs.length / 2 + " paired comparison(s)",
      "CPU temperature check " +
        (result.request.cpu_temperature_check === false ? "off" : "on"),
    ].join(" · ");
    const body = $("bench-table").querySelector("tbody");
    body.replaceChildren(
      ...result.runs.map((run) => {
        const row = document.createElement("tr");
        [
          run.repeat +
            " · " +
            (run.condition === "control" ? "Control" : "Wallpaper"),
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
    $("bench-pair").replaceChildren(
      ...[...new Set(result.runs.map((run) => run.repeat))].map(
        (repeat) => new Option(repeat, repeat),
      ),
    );
    $("bench-evidence").textContent = JSON.stringify(
      {
        ...result,
        runs: result.runs.map(({ plot, resources, ...run }) => run),
      },
      null,
      2,
    );
    draw();
    if ($("bench-dialog").open)
      $("bench-results").scrollIntoView({ block: "start" });
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
    if (!result || !$("bench-dialog").open) return;
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

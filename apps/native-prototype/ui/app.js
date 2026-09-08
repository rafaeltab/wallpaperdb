"use strict";
const $ = (id) => document.getElementById(id);
const token = document.querySelector('meta[name="wallpaperdb-token"]').content;
let state = { items: [], monitors: [], groups: [], surfaces: [] };
let selected = null,
  outputs = new Set(["DP-2"]),
  span = false,
  filter = "all",
  query = "",
  busy = false;
let toastTimer;
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icons = { image: "▧", video: "▷", live: "✧" };
const labels = { image: "Image", video: "Video", live: "Live wallpaper" };
async function api(data) {
  const response = await fetch("/api", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-WallpaperDB-Token": token,
    },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok || result.error)
    throw new Error(
      result.error || "The desktop service could not complete this action.",
    );
  return result;
}
function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 3500);
}
function error(error) {
  $("error").textContent = String(error.message || error);
  $("error").hidden = false;
}
function preview(item) {
  return item.preview
    ? `<img src="/preview/${encodeURIComponent(item.id)}" alt="${escape(item.title)}" loading="lazy">`
    : `<div class="placeholder">${icons[item.kind]}</div>`;
}
function detail() {
  const item = state.items.find((i) => i.id === selected);
  const experiment = $("experiment").value;
  $("hdr").disabled = ["baseline", "chromium"].includes(experiment);
  if (["baseline", "chromium"].includes(experiment)) $("hdr").checked = false;
  $("experiment-note").textContent = {
    baseline: "The original image, video, and HTML runtime. SDR presentation.",
    chromium:
      "HTML / JavaScript in Chromium. SDR bitmap transfer: compatible, but includes CPU copies.",
    "chromium-dmabuf":
      "Accelerated shared textures. Experimental: black SDR buffers and failed HDR imports on the tested NVIDIA driver.",
    gpu: "Fixed-rate Lua / GLSL rendering. Live bundles need scene.lua; images and videos use libmpv.",
    "gpu-paced":
      "Lua / GLSL waits for each visible display before drawing another shared frame. The slowest visible display paces a group; HDR uses the native pipeline.",
    "gpu-independent":
      "Lua / GLSL animates at the requested budget while video keeps its own playback clock. Live bundles need scene.lua; HDR uses the native pipeline.",
    "gpu-independent-drop":
      "Independent video clock with permission to skip video frames when decoding falls behind. Scene FPS is not video FPS; live bundles need scene.lua and HDR uses the native pipeline.",
  }[experiment];
  $("fps-note").textContent =
    experiment === "chromium" && Number($("fps").value) > 240
      ? "360 requested · Chromium SDR copy is capped at 240 fps"
      : experiment === "gpu-paced"
        ? "Maximum budget; compositor callbacks determine the delivered rate"
        : "Requested budget; diagnostics show the delivered frame rate";
  $("apply").disabled =
    !item || !outputs.size || busy || state.benchmark?.active;
  $("apply-target").textContent = outputs.size
    ? `Apply to ${[...outputs].join(" + ")}${span && outputs.size > 1 ? " · spanning" : ""}`
    : "Select a display above";
  if (!item) return;
  $("detail-art").innerHTML = preview(item);
  $("detail-title").textContent = item.title;
  $("detail-description").textContent = item.description;
  $("detail-tags").innerHTML =
    `<span>${labels[item.kind]}</span><span>On this device</span>`;
  $("reactivity").hidden = item.kind !== "live";
  $("audio").disabled = item.kind !== "live";
  $("fps").disabled =
    item.kind === "image" ||
    (item.kind !== "live" && experiment === "baseline");
  $("pause").disabled =
    state.benchmark?.active ||
    !state.groups.some((g) => g.outputs.some((o) => outputs.has(o)));
  $("pulse").disabled =
    state.benchmark?.active ||
    !state.surfaces.some((s) => outputs.has(s.output));
  $("pause").textContent = state.groups.some(
    (g) => g.paused && g.outputs.some((o) => outputs.has(o)),
  )
    ? "▷ Resume"
    : "Ⅱ Pause";
}
function gallery() {
  const items = state.items.filter(
    (i) =>
      (filter === "all" || i.kind === filter) &&
      `${i.title} ${i.description} ${i.tags.join(" ")}`
        .toLowerCase()
        .includes(query),
  );
  $("gallery").innerHTML = items
    .map(
      (item) =>
        `<button class="wallpaper-card ${item.id === selected ? "selected" : ""}" data-id="${escape(item.id)}" aria-label="Select ${escape(item.title)}" aria-pressed="${item.id === selected}"><div class="art">${preview(item)}<span class="type-badge ${item.kind}">${icons[item.kind]} ${labels[item.kind]}</span>${item.id === selected ? '<span class="selected-mark">✓</span>' : ""}</div><div class="card-meta"><strong>${escape(item.title)}</strong><small>${state.groups.some((g) => g.item === item.id) ? "● Applied" : "LOCAL"}</small></div><p class="card-description">${escape(item.description)}</p></button>`,
    )
    .join("");
  $("empty").hidden = items.length > 0;
  for (const button of $("gallery").querySelectorAll("button"))
    button.onclick = () => {
      selected = button.dataset.id;
      $("audio").checked =
        state.items.find((i) => i.id === selected).kind === "live";
      gallery();
      detail();
    };
  $("all-count").textContent = state.items.length;
  $("library-count").textContent = state.items.length;
}
function monitors() {
  const connected = state.monitors.filter((m) => !m.disabled);
  const rectangles = connected.map((m) => ({
    ...m,
    w: (m.transform % 2 ? m.height : m.width) / m.scale,
    h: (m.transform % 2 ? m.width : m.height) / m.scale,
  }));
  if (!rectangles.length) {
    $("monitor-map").textContent = "No displays connected";
    return;
  }
  const left = Math.min(...rectangles.map((r) => r.x)),
    top = Math.min(...rectangles.map((r) => r.y));
  const width = Math.max(...rectangles.map((r) => r.x + r.w)) - left,
    height = Math.max(...rectangles.map((r) => r.y + r.h)) - top;
  const container = $("monitor-map"),
    factor = Math.min(
      (container.clientWidth - 8) / width,
      (container.clientHeight - 8) / height,
    );
  const dx = (container.clientWidth - width * factor) / 2,
    dy = (container.clientHeight - height * factor) / 2;
  container.innerHTML = rectangles
    .map(
      (m) =>
        `<button class="monitor ${outputs.has(m.name) ? "selected" : ""} ${state.groups.some((g) => g.outputs.includes(m.name)) ? "active" : ""}" data-output="${escape(m.name)}" aria-label="Select display ${escape(m.name)}" aria-pressed="${outputs.has(m.name)}"><strong>${escape(m.name)}</strong><small>${Math.round(m.w)} × ${Math.round(m.h)}</small></button>`,
    )
    .join("");
  [...container.children].forEach((button, index) => {
    const m = rectangles[index];
    Object.assign(button.style, {
      left: `${dx + (m.x - left) * factor}px`,
      top: `${dy + (m.y - top) * factor}px`,
      width: `${Math.max(16, m.w * factor - 4)}px`,
      height: `${Math.max(16, m.h * factor - 4)}px`,
    });
    button.onclick = () => {
      outputs.has(m.name) ? outputs.delete(m.name) : outputs.add(m.name);
      monitors();
      detail();
    };
  });
}
let gallerySignature = "",
  monitorSignature = "";
function update(next) {
  state = next;
  window.updateBench?.(next);
  if (!selected || !state.items.some((i) => i.id === selected)) {
    selected = (state.items.find((i) => i.kind === "live") || state.items[0])
      ?.id;
    $("audio").checked =
      state.items.find((i) => i.id === selected)?.kind === "live";
  }
  const g = JSON.stringify([state.items, state.groups, selected]);
  if (g !== gallerySignature) {
    gallerySignature = g;
    gallery();
    detail();
  }
  const m = JSON.stringify([state.monitors, state.groups]);
  if (m !== monitorSignature) {
    monitorSignature = m;
    monitors();
    detail();
  }
  const running = state.surfaces.filter((s) => !s.paused).length;
  $("runtime-status").textContent = state.surfaces.length
    ? `${state.surfaces.length} display${state.surfaces.length === 1 ? "" : "s"} connected · ${running} active`
    : "Ready when you are · No wallpapers applied";
  $("experiment-stats").textContent = JSON.stringify(
    state.surfaces
      .filter((s) => outputs.has(s.output))
      .map((s) => ({
        output: s.output,
        experiment: s.group,
        paused: s.paused,
        ...s.telemetry,
      })),
    null,
    2,
  );
  const failure =
    state.warning ||
    state.surfaces.find((s) => s.telemetry.error)?.telemetry.error;
  if (failure) error(failure);
  else $("error").hidden = true;
}
async function action(data, message) {
  if (busy) return;
  busy = true;
  $("apply").disabled = true;
  $("error").hidden = true;
  try {
    update(await api(data));
    if (message) toast(message);
  } catch (e) {
    error(e);
  } finally {
    busy = false;
    detail();
  }
}
$("apply").onclick = () =>
  action(
    {
      op: "set",
      source: selected,
      outputs: [...outputs],
      span,
      fps: Number($("fps").value),
      audio: $("audio").checked,
      experiment: $("experiment").value,
      hdr: $("hdr").checked,
      keep_playing: $("keep-playing").checked,
    },
    "A new atmosphere. Wallpaper applied.",
  );
$("experiment").onchange = detail;
$("fps").onchange = detail;
$("import").onclick = () => action({ op: "choose" });
$("import-bundle").onclick = () => action({ op: "choose", folder: true });
$("refresh").onclick = () =>
  action({ op: "status" }, "Your library is up to date.");
$("clear").onclick = () =>
  action(
    { op: "clear", outputs: [...outputs] },
    "Previous backgrounds restored.",
  );
$("pause").onclick = () =>
  action({
    op: "pause",
    outputs: [...outputs],
    paused: !state.groups.some(
      (g) => g.paused && g.outputs.some((o) => outputs.has(o)),
    ),
  });
$("pulse").onclick = () =>
  action(
    { op: "signal", name: "key", value: "Space", outputs: [...outputs] },
    "Pulse sent to your live wallpaper.",
  );
for (const id of ["independent", "span"])
  $(id).onclick = () => {
    span = id === "span";
    $("span").classList.toggle("selected", span);
    $("independent").classList.toggle("selected", !span);
    $("layout-explanation").textContent = span
      ? "One continuous scene across the selected displays."
      : "Fill each selected display independently.";
    detail();
  };
for (const button of document.querySelectorAll("[data-filter]"))
  button.onclick = () => {
    filter = button.dataset.filter;
    for (const b of document.querySelectorAll("[data-filter]")) {
      b.classList.toggle("selected", b === button);
      b.setAttribute("aria-selected", String(b === button));
    }
    gallery();
  };
$("search").oninput = () => {
  query = $("search").value.toLowerCase();
  gallery();
};
$("displays-nav").onclick = () =>
  document
    .querySelector(".display-section")
    .scrollIntoView({ behavior: "smooth" });
$("library-nav").onclick = () =>
  document.querySelector(".collection").scrollIntoView({ behavior: "smooth" });
new ResizeObserver(monitors).observe($("monitor-map"));
document.addEventListener("keydown", (event) => {
  if (event.target.matches("input,select,textarea")) return;
  if (event.key === "/") {
    event.preventDefault();
    $("search").focus();
  }
  if (
    event.code === "Space" &&
    !event.repeat &&
    !event.target.matches("button")
  ) {
    event.preventDefault();
    $("pulse").click();
  }
});
async function refresh() {
  if (document.hidden || busy) return;
  try {
    update(await api({ op: "status" }));
  } catch (e) {
    error(e);
  }
}
refresh();
setInterval(refresh, 2000);

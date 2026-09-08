// Drives the real local control UI in Chromium using CDP; no npm install needed.
import { spawn } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const runtime = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`;
const reportArgument = process.argv
  .find((value) => value.startsWith("--report="))
  ?.slice(9);
const url = reportArgument
  ? pathToFileURL(resolve(reportArgument)).href
  : readFileSync(join(runtime, "wallpaperdb-native-prototype/url"), "utf8");
const cache = join(homedir(), ".cache/ms-playwright");
const chrome =
  process.env.CHROME ||
  join(
    cache,
    readdirSync(cache)
      .filter((x) => x.startsWith("chromium-"))
      .sort()
      .at(-1),
    "chrome-linux64/chrome",
  );
const profile = mkdtempSync(join(tmpdir(), "wallpaperdb-browser-"));
const evidence = resolve("apps/native-prototype/verification");
mkdirSync(evidence, { recursive: true });
const child = spawn(
  chrome,
  [
    "--headless",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
const address = await new Promise((resolve, reject) => {
  const timeout = setTimeout(
    () => reject(new Error("Chromium did not start")),
    15000,
  );
  child.on("error", reject);
  child.stderr.on("data", (data) => {
    const match = data.toString().match(/DevTools listening on (ws:\/\/\S+)/);
    if (match) {
      clearTimeout(timeout);
      resolve(match[1]);
    }
  });
});
const socket = new WebSocket(address);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});
let counter = 0;
const pending = new Map();
socket.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id) {
    const entry = pending.get(msg.id);
    if (entry) {
      clearTimeout(entry.timer);
      pending.delete(msg.id);
      msg.error
        ? entry.reject(new Error(JSON.stringify(msg.error)))
        : entry.resolve(msg.result);
    }
  }
};
function rpc(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++counter;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
}
const { targetId } = await rpc("Target.createTarget", { url: "about:blank" });
const { sessionId } = await rpc("Target.attachToTarget", {
  targetId,
  flatten: true,
});
const call = (method, params) => rpc(method, params, sessionId);
async function js(expression) {
  const result = await call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails)
    throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(expression) {
  for (let i = 0; i < 100; i++) {
    if (await js(expression)) return;
    await pause(100);
  }
  throw new Error(`Timed out: ${expression}`);
}
const settings = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((v) => v.includes("="))
    .map((v) => [v.slice(2, v.indexOf("=")), v.slice(v.indexOf("=") + 1)]),
);
const runGame =
  process.argv.includes("--run") || process.argv.includes("--cancel");
let started = false;
try {
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await call("Page.navigate", { url });
  if (settings.report) {
    await until(
      "window.GAME_BENCH_RESULTS?.length > 0 && document.querySelectorAll('#overview tbody tr').length === window.GAME_BENCH_RESULTS.length",
    );
    const count = await js("window.GAME_BENCH_RESULTS.length");
    for (let index = 0; index < count; index++) {
      await js(
        "document.querySelectorAll('#overview button')[" + index + "].click()",
      );
      assert.equal(
        await js("document.querySelectorAll('#runs tbody tr').length >= 2"),
        true,
      );
      for (const axis of ["scene_s", "time_s"]) {
        for (const metric of [
          "gpu_percent",
          "game_cpu_one_core_percent",
          "watts",
          "vram_used_mib",
        ]) {
          await js(
            "document.querySelector('#axis').value=" +
              JSON.stringify(axis) +
              ";document.querySelector('#metric').value=" +
              JSON.stringify(metric) +
              ";document.querySelector('#metric').dispatchEvent(new Event('change'))",
          );
          assert.equal(
            await js(
              "document.querySelector('#frames').getContext('2d').getImageData(0,0,400,100).data.some(v=>v!==0)",
            ),
            true,
          );
        }
      }
    }
    await js(
      "document.querySelectorAll('#overview button')[1].click();document.querySelector('#metric').value='gpu_percent';document.querySelector('#axis').value='scene_s';document.querySelector('#metric').dispatchEvent(new Event('change'))",
    );
  } else {
    await until("typeof state !== 'undefined' && state.items.length > 0");
    await js(
      `document.querySelector('#search').value=${JSON.stringify(settings.source || "Prism laboratory")};document.querySelector('#search').dispatchEvent(new Event('input'));document.querySelector('.wallpaper-card').click()`,
    );
    await js(
      `document.querySelector('#experiment').value=${JSON.stringify(settings.experiment || "gpu")};document.querySelector('#experiment').dispatchEvent(new Event('change'));document.querySelector('#fps').value=${JSON.stringify(settings.fps || "120")};document.querySelector('#bench').click()`,
    );
    assert.equal(
      await js("document.querySelector('#bench-dialog').open"),
      true,
    );
    await js("document.querySelector('#bench-close').click()");
    // Choose library state through the same controls a user operates.
    if (settings["source-id"]) {
      await js(
        "document.querySelector('#search').value='';document.querySelector('#search').dispatchEvent(new Event('input'))",
      );
      await js(
        "document.querySelector(" +
          JSON.stringify(
            '.wallpaper-card[data-id="' + settings["source-id"] + '"]',
          ) +
          ").click()",
      );
    }
    if (settings["wallpaper-outputs"]) {
      await js(
        "for (const button of document.querySelectorAll('.monitor')) { const wanted=" +
          JSON.stringify(settings["wallpaper-outputs"].split(",")) +
          ".includes(button.dataset.output); if (wanted !== button.classList.contains('selected')) button.click(); }",
      );
    }
    await js(
      "document.querySelector(" +
        JSON.stringify(settings.span === "true" ? "#span" : "#independent") +
        ").click();" +
        "document.querySelector('#audio').checked=" +
        (settings.audio === "true") +
        ";" +
        "document.querySelector('#hdr').checked=" +
        (settings.hdr === "true") +
        ";",
    );
    await js("document.querySelector('#bench').click()");
    assert.equal(
      await js("document.documentElement.scrollWidth <= innerWidth"),
      true,
    );
    await js(
      `document.querySelector('#bench-output').value=${JSON.stringify(settings.output || "DP-5")};document.querySelector('#bench-cap').value=${JSON.stringify(settings.cap || "120")};document.querySelector('#bench-seconds').value=${JSON.stringify(settings.seconds || "20")};document.querySelector('#bench-repeats').value=${JSON.stringify(settings.repeats || "1")};document.querySelector('#bench-resolution').value=${JSON.stringify(settings.resolution || "current")};document.querySelector('#bench-preset').value=${JSON.stringify(settings.preset || "current")};document.querySelector('#bench-policy').value=${JSON.stringify(settings.policy || "active")};document.querySelector('#bench-demo').value=${JSON.stringify(settings.demo || "")}`,
    );
    const before = await js("JSON.stringify(state.groups)");
    assert.equal(
      await js(
        "document.querySelector('#bench-cpu-temperature-check').checked",
      ),
      true,
      "CPU temperature check should default to enabled",
    );
    if (process.argv.includes("--temperature-option")) {
      // Exercise form submission without launching a game or changing the desktop.
      await js(
        "window.__benchOriginalApi=api;window.__benchTemperatureRequests=[];api=async request=>{if(request.op==='bench_start'){window.__benchTemperatureRequests.push(request);throw new Error('UI-only temperature-option check');}return window.__benchOriginalApi(request);}",
      );
      try {
        for (const [index, enabled] of [true, false, true].entries()) {
          await js(
            "if(document.querySelector('#bench-cpu-temperature-check').checked!==" +
              enabled +
              ")document.querySelector('#bench-cpu-temperature-check').click();document.querySelector('#bench-start').click()",
          );
          await until(
            "window.__benchTemperatureRequests.length===" + (index + 1),
          );
          assert.equal(
            await js(
              "window.__benchTemperatureRequests.at(-1).cpu_temperature_check",
            ),
            enabled,
          );
        }
      } finally {
        await js("api=window.__benchOriginalApi;updateBench(state)");
      }
      assert.equal(await js("JSON.stringify(state.groups)"), before);
      console.log(
        "CPU temperature option: default, disabled and re-enabled submissions verified",
      );
    }
    if (settings["cpu-temperature-check"] === "false")
      await js(
        "document.querySelector('#bench-cpu-temperature-check').click()",
      );
    if (runGame) {
      await js("document.querySelector('#bench-start').click()");
      await until("state.benchmark?.active");
      started = true;
      assert.equal(
        await js(
          "document.querySelector('#apply').disabled && document.querySelector('#import').disabled",
        ),
        true,
      );
      if (process.argv.includes("--cancel")) {
        await pause(5000);
        await js("document.querySelector('#bench-cancel').click()");
      }
      let previous = "";
      for (let i = 0; i < 950; i++) {
        const job = await js("state.benchmark");
        const phase = job.state + ": " + job.phase;
        if (phase !== previous) {
          console.log(JSON.stringify(job));
          previous = phase;
        }
        if (!job.active) break;
        await pause(1000);
      }
      const job = await js("state.benchmark");
      assert.equal(
        JSON.parse(readFileSync(join(job.directory, "job.json"), "utf8"))
          .cpu_temperature_check,
        settings["cpu-temperature-check"] !== "false",
        "Worker job did not retain the selected CPU temperature policy",
      );
      assert.equal(job.active, false, "Job exceeded deadline");
      assert.equal(
        job.state,
        process.argv.includes("--cancel")
          ? "cancelled"
          : settings.expect || "complete",
        job.error,
      );
      assert.equal(
        await js("JSON.stringify(state.groups)"),
        before,
        "Wallpaper assignments were not restored exactly",
      );
      if (job.state === "complete") {
        await until("!document.querySelector('#bench-results').hidden");
        assert.equal(
          await js("document.querySelectorAll('#bench-table tbody tr').length"),
          Number(settings.repeats || 1) * 2,
        );
        assert.equal(
          await js("document.querySelector('#bench-frames').width > 0"),
          true,
        );
        for (const axis of ["time_s", "scene_s"]) {
          for (const metric of [
            "gpu_percent",
            "game_cpu_one_core_percent",
            "watts",
            "vram_used_mib",
          ]) {
            await js(
              "document.querySelector('#bench-axis').value=" +
                JSON.stringify(axis) +
                ";document.querySelector('#bench-metric').value=" +
                JSON.stringify(metric) +
                ";document.querySelector('#bench-metric').dispatchEvent(new Event('change'));",
            );
            assert.equal(
              await js(
                "document.querySelector('#bench-resources').getContext('2d').getImageData(0,0,400,100).data.some(v=>v!==0)",
              ),
              true,
            );
          }
        }
        await js(
          "document.querySelector('#bench-metric').value='gpu_percent';document.querySelector('#bench-metric').dispatchEvent(new Event('change'))",
        );
        console.log(
          await js("document.querySelector('#bench-verdict').textContent"),
        );
      }
      writeFileSync(
        join(evidence, "game-bench-ui-job.json"),
        JSON.stringify(job, null, 2),
      );
      assert.equal(
        await js(
          "document.querySelector('#apply').disabled || document.querySelector('#import').disabled || document.querySelector('#bench-start').disabled",
        ),
        false,
      );
    }
    if (settings.history) {
      await until("!document.querySelector('#bench-results').hidden");
      assert.equal(await js("state.benchmark.id"), settings.history);
    }
  }
  const shot = await call("Page.captureScreenshot", { format: "png" });
  writeFileSync(
    join(
      evidence,
      settings.report ? "game-bench-report.png" : "game-bench-ui.png",
    ),
    Buffer.from(shot.data, "base64"),
  );
  await call("Emulation.setDeviceMetricsOverride", {
    width: 700,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await pause(200);
  assert.equal(
    await js("document.documentElement.scrollWidth <= innerWidth"),
    true,
  );
  console.log("Bench UI verified");
} finally {
  if (started) {
    try {
      if (await js("state.benchmark?.active"))
        await js("api({op:'bench_cancel'})");
    } catch {}
  }
  socket.close();
  child.kill("SIGTERM");
  await pause(500);
  rmSync(profile, { recursive: true, force: true });
}

// Explicit local report UI smoke; no renderer control, installation or GPU use.
// make native-stress-report-ui-test ARGS='REPORT.html SCREENSHOT.png'
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [reportArgument, screenshotArgument] = process.argv.slice(2);
assert(
  reportArgument && screenshotArgument && process.argv.length === 4,
  "Usage: node wdb-stress-report-ui-test.mjs REPORT.html SCREENSHOT.png",
);
const report = resolve(reportArgument),
  screenshot = resolve(screenshotArgument);
assert(report !== screenshot, "Screenshot must not overwrite the report");
const reportBytes = readFileSync(report);
assert(
  reportBytes.length <= 128 * 1024 * 1024,
  "Report exceeds the 128 MiB smoke-test input bound",
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const reportSha = sha(reportBytes);
const cache = join(homedir(), ".cache/ms-playwright");
const candidates = existsSync(cache)
  ? readdirSync(cache)
      .filter((name) => name.startsWith("chromium-"))
      .sort()
      .reverse()
      .flatMap((name) => [
        join(cache, name, "chrome-linux64/chrome"),
        join(cache, name, "chrome-linux/chrome"),
      ])
  : [];
const chrome = process.env.CHROME || candidates.find(existsSync);
assert(chrome, "No local Chromium found; set CHROME to an existing executable");
assert(
  typeof WebSocket === "function",
  "This script requires Node's built-in WebSocket",
);
const profile = mkdtempSync(join(tmpdir(), "wdb-report-smoke-"));
let child,
  socket,
  expired = false,
  counter = 0,
  deadlineTimer,
  outcome;
const pending = new Map(),
  errors = [],
  checks = [];
const flags = [
  "--headless",
  "--disable-gpu",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-sync",
  "--disable-extensions",
  "--no-first-run",
  "--no-default-browser-check",
  "--remote-debugging-address=127.0.0.1",
  "--remote-debugging-port=0",
  `--user-data-dir=${profile}`,
  "about:blank",
];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let rejectInterruption;
const interrupted = new Promise((_, reject) => {
  rejectInterruption = reject;
});
function stop(signum) {
  if (expired) return;
  expired = true;
  rejectInterruption(new Error(signum));
}
const onInt = () => stop("Interrupted by SIGINT"),
  onTerm = () => stop("Interrupted by SIGTERM");
process.on("SIGINT", onInt);
process.on("SIGTERM", onTerm);

function rpc(method, params = {}, sessionId) {
  if (expired)
    return Promise.reject(new Error("Report smoke deadline/interrupt reached"));
  return new Promise((resolve, reject) => {
    const id = ++counter;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 8000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

async function exercise() {
  child = spawn(chrome, flags, { stdio: ["ignore", "ignore", "pipe"] });
  const address = await new Promise((resolve, reject) => {
    let diagnostic = "";
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      reject(new Error(`Chromium exited during startup: ${code}/${signal}`)),
    );
    child.stderr.on("data", (chunk) => {
      diagnostic = (diagnostic + chunk.toString()).slice(-65536);
      const match = diagnostic.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) resolve(match[1]);
    });
  });
  socket = new WebSocket(address);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown" && errors.length < 20)
      errors.push(
        message.params.exceptionDetails.text +
          ": " +
          (message.params.exceptionDetails.exception?.description || ""),
      );
    const entry = pending.get(message.id);
    if (entry) {
      clearTimeout(entry.timer);
      pending.delete(message.id);
      message.error
        ? entry.reject(new Error(JSON.stringify(message.error)))
        : entry.resolve(message.result);
    }
  };
  const { targetId } = await rpc("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await rpc("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const call = (method, params) => rpc(method, params, sessionId);
  async function js(expression) {
    const value = await call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (value.exceptionDetails)
      throw new Error(JSON.stringify(value.exceptionDetails));
    return value.result.value;
  }
  async function until(expression) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await js(expression)) return;
      await pause(100);
    }
    throw new Error(`Report never became ready: ${expression}`);
  }
  async function check(name, expression) {
    assert.equal(await js(expression), true, name);
    checks.push(name);
  }
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Network.enable");
  await call("Network.setBlockedURLs", { urls: ["http://*", "https://*"] });
  await call("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const navigation = await call("Page.navigate", {
    url: pathToFileURL(report).href,
  });
  assert(!navigation.errorText, navigation.errorText);
  await until(
    "document.readyState==='complete' && document.querySelector('#run-select')?.options.length>0",
  );
  const dimensions = await js(
    "({runs:data.runs.length,groups:data.groups.length,studies:data.studies.length})",
  );
  await check(
    "Report fits the viewport",
    "document.documentElement.scrollWidth<=innerWidth",
  );
  await check(
    "CPU metric run counts are shown",
    "$('count').textContent.includes('CPU means') && $('groups').textContent.includes('tails')",
  );
  await check(
    "Baseline label covers its three paths",
    "[...$('engine').options].some(o=>o.textContent.includes('GTK · WebKit · mpvpaper'))",
  );
  await check(
    "Independent media engine has a readable name",
    "[...$('engine').options].some(o=>o.textContent.includes('independent media clock'))",
  );
  const unknown = await js(
    "data.runs.find(r=>r.valid&&!r.cpu_metrics_available.weighted_mean)?.id || data.runs.find(r=>!r.cpu_metrics_available.weighted_mean)?.id",
  );
  assert(
    unknown,
    "Final dataset must include a CPU-unknown example for this smoke check",
  );
  await js(`choose(${JSON.stringify(unknown)})`);
  await check(
    "Unknown CPU is explicit",
    "$('cpu-detail').textContent.includes('weighted mean: unknown') && $('selection-errors').textContent.includes('CPU mean unavailable')",
  );
  await check(
    "Unsupported CPU peaks are not drawn",
    "!$('cpu-plot').querySelector('circle') && $('cpu-plot').textContent.includes('unavailable')",
  );
  const retained = await js(
    "data.runs.find(r=>r.content_behavior==='retained_static')?.id",
  );
  assert(retained, "Final dataset must include a retained static image");
  await js(`choose(${JSON.stringify(retained)})`);
  await check(
    "Retained static zero-frame semantics are explained",
    "$('behavior-detail').textContent.includes('zero new presentations') && $('behavior-detail').textContent.includes('missing feedback remains unavailable')",
  );
  const paused = await js(
    "data.runs.find(r=>r.content_behavior==='paused')?.id",
  );
  assert(paused, "Final dataset must include a pause comparison");
  await js(`choose(${JSON.stringify(paused)})`);
  await check(
    "Pause evidence is separate from a pause request",
    "$('behavior-detail').textContent.includes('Pause requested') && $('behavior-detail').textContent.includes('evidence')",
  );
  const plotted = await js(
    "data.runs.find(r=>r.valid&&r.plots.wallpaper.max_ms.length)?.id",
  );
  assert(
    plotted,
    "Final dataset must include valid wallpaper interval measurements",
  );
  await js(
    `choose(${JSON.stringify(plotted)});const selected=byId.get(${JSON.stringify(plotted)});for(const key of ['study','engine','batch']){$(key).value=selected[key];$(key).dispatchEvent(new Event('change'));}`,
  );
  await check(
    "Study/engine/batch filters match every offered run",
    "[...$('run-select').options].length>0 && [...$('run-select').options].every(o=>['study','engine','batch'].every(k=>byId.get(o.value)[k]===$(k).value))",
  );
  await js(
    `choose(${JSON.stringify(plotted)});$('from').value=byId.get(${JSON.stringify(plotted)}).plots.wallpaper.max_ms[0][0];$('from').dispatchEvent(new Event('input'));`,
  );
  await check(
    "Selected interval samples are plotted",
    "$('wall-plot').querySelectorAll('circle').length>0",
  );
  await check(
    "Selected record and raw links are inspectable",
    "$('run-record').textContent.includes('cpu_evidence') && $('raw-links').querySelectorAll('a').length>0",
  );
  // Add one synthetic selector option to exercise the actual empty-filter UI;
  // selecting an absent HTML option would silently reset a select to no filter.
  await js(
    "$('study').add(new Option('Smoke: no matching study','__wdb_empty__'));$('study').value='__wdb_empty__';$('study').dispatchEvent(new Event('change'));",
  );
  await check(
    "Empty filters clear stale selection and plots",
    "$('run-select').options.length===0 && $('selected-context').textContent==='No selected run.' && $('groups').textContent.includes('No groups match') && $('wall-plot').innerHTML==='' && $('cpu-detail').textContent===''",
  );
  await js(
    "$('study').querySelector('option[value=\"__wdb_empty__\"]').remove();for(const key of ['study','engine','batch'])$(key).value='';$('study').dispatchEvent(new Event('change'));",
  );
  await js(
    `choose(${JSON.stringify(plotted)});document.querySelector('#selected-context').scrollIntoView({block:'start'});`,
  );
  await pause(150);
  assert.deepEqual(errors, [], "Report raised JavaScript exceptions");
  const image = await call("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  assert(!expired, "Deadline reached before screenshot publication");
  const bytes = Buffer.from(image.data, "base64");
  assert(
    bytes.length <= 16 * 1024 * 1024,
    "Screenshot exceeds its 16 MiB publication bound",
  );
  assert.equal(
    sha(readFileSync(report)),
    reportSha,
    "Report changed during the UI check",
  );
  mkdirSync(dirname(screenshot), { recursive: true });
  writeFileSync(screenshot, bytes);
  return {
    result: "passed",
    ...dimensions,
    checks,
    report_sha256: reportSha,
    script_sha256: sha(readFileSync(new URL(import.meta.url))),
    screenshot,
    screenshot_sha256: sha(bytes),
    browser: chrome,
    headless: true,
    gpu_disabled: true,
    deadline_seconds: 45,
  };
}

try {
  const deadline = new Promise((_, reject) => {
    deadlineTimer = setTimeout(() => {
      expired = true;
      reject(new Error("Report UI smoke exceeded 45 seconds"));
    }, 45000);
  });
  outcome = await Promise.race([exercise(), deadline, interrupted]);
} finally {
  clearTimeout(deadlineTimer);
  // Signal only the owned child handle, never a reaped PID's process group.
  if (socket?.readyState === WebSocket.OPEN && !expired) {
    await Promise.race([rpc("Browser.close").catch(() => {}), pause(1000)]);
  }
  expired = true;
  for (const { reject, timer } of pending.values()) {
    clearTimeout(timer);
    reject(new Error("Report smoke cleanup"));
  }
  pending.clear();
  socket?.close();
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      pause(1000),
    ]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        pause(1000),
      ]);
    }
  }
  const exited = !child || child.exitCode !== null || child.signalCode !== null;
  if (exited) rmSync(profile, { recursive: true, force: true });
  process.off("SIGINT", onInt);
  process.off("SIGTERM", onTerm);
  assert(
    exited,
    `Owned browser did not exit; retained temporary profile ${profile}`,
  );
}
console.log(JSON.stringify(outcome, null, 2));

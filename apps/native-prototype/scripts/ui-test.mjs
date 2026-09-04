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

const runtime = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`;
const url = readFileSync(
  join(runtime, "wallpaperdb-native-prototype/url"),
  "utf8",
);
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
try {
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 980,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await call("Page.navigate", { url });
  await until("document.querySelectorAll('.wallpaper-card').length >= 5");
  assert.equal(
    await js("document.querySelector('.monitor.selected').dataset.output"),
    "DP-2",
  );
  assert.equal(
    await js("document.documentElement.scrollWidth <= innerWidth"),
    true,
  );
  await js("document.querySelector('[data-filter=video]').click()");
  assert.equal(
    await js("document.querySelectorAll('.wallpaper-card').length"),
    1,
  );
  await js("document.querySelector('[data-filter=live]').click()");
  assert.equal(
    await js("document.querySelectorAll('.wallpaper-card').length"),
    2,
  );
  await js(
    "document.querySelector('[data-filter=all]').click(); document.querySelector('#search').value='Rose hour'; document.querySelector('#search').dispatchEvent(new Event('input'))",
  );
  assert.equal(
    await js("document.querySelectorAll('.wallpaper-card').length"),
    1,
  );
  await js(
    "document.querySelector('.wallpaper-card').click();document.querySelector('#search').value='';document.querySelector('#search').dispatchEvent(new Event('input'));document.querySelector('#apply').click()",
  );
  await until("!document.querySelector('#toast').hidden");
  await until("document.querySelector('#apply').disabled === false");
  await js("document.querySelector('#pause').click()");
  await until(
    "document.querySelector('#pause').textContent.includes('Resume')",
  );
  await js("document.querySelector('#pause').click()");
  await until("document.querySelector('#pause').textContent.includes('Pause')");
  await js("document.querySelector('#pulse').click()");
  await until(
    "document.querySelector('#toast').textContent.includes('Pulse sent')",
  );
  await js(
    "document.querySelector('#toast').hidden=true;document.querySelector('#apply').blur()",
  );
  await call("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: " ",
    code: "Space",
    windowsVirtualKeyCode: 32,
  });
  await call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: " ",
    code: "Space",
    windowsVirtualKeyCode: 32,
  });
  await until(
    "document.querySelector('#toast').textContent.includes('Pulse sent')",
  );
  const screenshot = await call("Page.captureScreenshot", { format: "png" });
  writeFileSync(
    join(evidence, "library-ui.png"),
    Buffer.from(screenshot.data, "base64"),
  );
  await call("Emulation.setDeviceMetricsOverride", {
    width: 600,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await pause(150);
  assert.equal(
    await js("document.documentElement.scrollWidth <= innerWidth"),
    true,
  );
  const narrow = await call("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
  });
  writeFileSync(
    join(evidence, "library-narrow.png"),
    Buffer.from(narrow.data, "base64"),
  );
  console.log(
    "UI passed: library, filters, search, display selection, real apply, pause/resume, button and keyboard signals, responsive widths.",
  );
} finally {
  socket.close();
  child.kill();
  await new Promise((r) => child.once("exit", r));
  rmSync(profile, { recursive: true, force: true });
}

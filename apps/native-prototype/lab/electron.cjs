// Chromium producer. Its invisible offscreen window never becomes a desktop toplevel.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const { pathToFileURL } = require("node:url");
const transport = require("./build/dmabuf.node");
const configPath = process.argv.at(-1);
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
// Electron 42.7: the 240 FPS ceiling applies only to bitmap offscreen mode.
// https://github.com/electron/electron/blob/v42.7.0/docs/api/web-contents.md#contentssetframeratefps
const producerFpsCap = config.experiment === "chromium" ? 240 : null;
let producerTargetFps = null;
app.setPath(
  "userData",
  path.join(path.dirname(configPath), `chromium-${process.pid}`),
);
app.commandLine.appendSwitch("ozone-platform", "wayland");
app.commandLine.appendSwitch("enable-unsafe-webgpu");

app.commandLine.appendSwitch("disable-renderer-backgrounding");
if (config.experiment === "chromium-dmabuf") {
  app.commandLine.appendSwitch("enable-features", "Vulkan");
  app.commandLine.appendSwitch("use-angle", "vulkan");
}
let helper,
  win,
  fd,
  stopping = false,
  nextId = 1,
  browser = {},
  frameDrops = 0;
const pending = new Map();
function stop() {
  if (stopping) return;
  stopping = true;
  win?.webContents.stopPainting();
  const finish = () => {
    for (const texture of pending.values()) texture.release();
    pending.clear();
    if (fd !== undefined) transport.close(fd);
    fd = undefined;
    win?.destroy();
    app.quit();
  };
  if (helper && helper.exitCode === null && helper.signalCode === null) {
    helper.once("exit", finish);
    helper.kill("SIGTERM");
    const timer = setTimeout(() => helper.kill("SIGKILL"), 1200);
    timer.unref();
  } else finish();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.stdin.on("end", stop);
app.on("window-all-closed", () => {});
function evaluate(source) {
  if (!stopping && win && !win.isDestroyed() && !win.webContents.isLoading())
    win.webContents
      .executeJavaScript(source)
      .catch((e) => process.stderr.write(`${e.message}\n`));
}
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  if (stopping) return;
  try {
    const input = JSON.parse(line);
    helper?.stdin.write(line + "\n");
    if (input.signal)
      evaluate(
        `window.__wallpaperHost?.signal(${JSON.stringify(input.signal)})`,
      );
    else {
      evaluate(`window.__wallpaperHost?.update(${line})`);
      if (typeof input.paused === "boolean" && win) {
        if (input.paused) win.webContents.stopPainting();
        else win.webContents.startPainting();
      }
    }
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
  }
});
app
  .whenReady()
  .then(async () => {
    helper = spawn(path.join(__dirname, "build/presenter"), [configPath], {
      stdio: ["pipe", "pipe", "inherit"],
    });
    helper.on("exit", (code) => {
      if (!stopping) {
        process.exitCode = code || 1;
        process.stdout.write(
          JSON.stringify({
            state: "error",
            error: `Presenter exited ${code}; inspect ${configPath.replace(/\.json$/, ".log")}`,
          }) + "\n",
        );
        process.stderr.write(`Presenter exited ${code}\n`);
        stop();
      }
    });
    readline.createInterface({ input: helper.stdout }).on("line", (line) => {
      try {
        const telemetry = JSON.parse(line);
        telemetry.browser = browser;
        if (browser.error) {
          telemetry.state = "error";
          telemetry.error = browser.error;
        }
        telemetry.producer_drops = frameDrops;
        telemetry.electron = process.versions.electron;
        telemetry.chromium = process.versions.chrome;
        telemetry.producer_target_fps = producerTargetFps;
        telemetry.producer_fps_cap = producerFpsCap;
        telemetry.fps_limit_reason =
          producerFpsCap === null
            ? "360 FPS application limit; Electron shared textures have no 240 FPS cap"
            : "Electron bitmap offscreen rendering is capped at 240 FPS";
        if (producerTargetFps !== null)
          telemetry.target_fps = Math.min(
            telemetry.target_fps,
            producerTargetFps,
          );
        process.stdout.write(JSON.stringify(telemetry) + "\n");
      } catch {}
    });
    for (let i = 0; i < 100 && !stopping; i++) {
      try {
        fd = transport.connect(config.socket);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    if (fd === undefined)
      throw new Error("Presenter DMA-BUF socket did not start");
    win = new BrowserWindow({
      show: false,
      width: config.width,
      height: config.height,
      backgroundColor: "#000000",
      webPreferences: {
        offscreen:
          config.experiment === "chromium-dmabuf"
            ? {
                useSharedTexture: true,
                sharedTexturePixelFormat: config.hdr ? "rgbaf16" : "argb",
                deviceScaleFactor: 1,
              }
            : { useSharedTexture: false },
        backgroundThrottling: false,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    win.webContents.setAudioMuted(true);
    win.webContents.setFrameRate(
      Math.min(config.fps, producerFpsCap ?? config.fps),
    );
    producerTargetFps = win.webContents.getFrameRate();
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.session.setPermissionRequestHandler((_w, _p, callback) =>
      callback(false),
    );
    win.webContents.on("console-message", (_event, ...args) => {
      const message = typeof args[0] === "object" ? args[0].message : args[1];
      if (
        typeof message === "string" &&
        message.startsWith("WALLPAPER_STATS ")
      ) {
        try {
          browser = JSON.parse(message.slice(16));
        } catch {}
      } else if (message) process.stderr.write(`scene: ${message}\n`);
    });
    const buffers = [0, 1].map((i) => {
      const p = configPath + `.frame-${i}`;
      const fd = fs.openSync(p, "w+");
      fs.ftruncateSync(fd, config.width * config.height * 4);
      fs.unlinkSync(p);
      return fd;
    });
    win.webContents.on("paint", (event, _dirty, image) => {
      if (stopping) {
        event.texture?.release();
        return;
      }
      if (config.experiment === "chromium") {
        for (const id of transport.poll(fd)) {
          pending.get(id)?.release();
          pending.delete(id);
        }
        if (!buffers.length) {
          frameDrops++;
          return;
        }
        const buffer = image.toBitmap(),
          size = image.getSize();
        const memory = buffers.pop();
        fs.writeSync(memory, buffer, 0, buffer.length, 0);
        const id = nextId++;
        const header = {
          id,
          width: size.width,
          height: size.height,
          format: "bitmap",
          color: "sRGB SDR copy",
          modifier: "0",
          planes: [{ stride: size.width * 4, offset: 0 }],
        };
        if (transport.submit(fd, JSON.stringify(header), [memory]))
          pending.set(id, { release: () => buffers.push(memory) });
        else {
          frameDrops++;
          buffers.push(memory);
        }
        return;
      }

      const texture = event.texture;
      if (!texture) return;
      for (const id of transport.poll(fd)) {
        pending.get(id)?.release();
        pending.delete(id);
      }
      if (pending.size >= 2) {
        frameDrops++;
        texture.release();
        return;
      }
      const info = texture.textureInfo,
        native = info.handle.nativePixmap,
        id = nextId++;
      const header = {
        id,
        width: info.codedSize.width,
        height: info.codedSize.height,
        format: info.pixelFormat,
        color: JSON.stringify(info.colorSpace),
        modifier: native.modifier,
        planes: native.planes.map((p) => ({
          stride: p.stride,
          offset: p.offset,
        })),
        timestamp: info.timestamp,
      };
      if (
        transport.submit(
          fd,
          JSON.stringify(header),
          native.planes.map((p) => p.fd),
        )
      )
        pending.set(id, texture);
      else {
        frameDrops++;
        texture.release();
      }
    });
    const releaseTimer = setInterval(() => {
      if (fd !== undefined && !stopping)
        for (const id of transport.poll(fd)) {
          pending.get(id)?.release();
          pending.delete(id);
        }
    }, 8);
    releaseTimer.unref();
    const runtime = fs.readFileSync(
      path.join(__dirname, "../runtime/wallpaper.js"),
      "utf8",
    );
    const injection = `window.__WALLPAPER_CONFIG__=${JSON.stringify({ canvas: { width: config.width, height: config.height }, viewport: { x: 0, y: 0, width: config.width, height: config.height }, epoch: config.epoch, fps: producerTargetFps, synchronize: false, hdr: config.hdr })};window.webkit={messageHandlers:{telemetry:{postMessage:(v)=>console.debug('WALLPAPER_STATS '+v)}}};${runtime}`;
    let body;
    if (config.kind === "live") body = fs.readFileSync(config.source, "utf8");
    else {
      const url = pathToFileURL(config.source).href;
      const element =
        config.kind === "video"
          ? `<video src="${url}" autoplay muted loop></video>`
          : `<img src="${url}">`;
      body = `<html><head><style>html,body,#scene{margin:0;width:100%;height:100%;overflow:hidden;background:black}img,video{width:100%;height:100%;object-fit:cover}</style></head><body><div id="scene">${element}</div></body></html>`;
    }
    const wrapper = configPath.replace(/\.json$/, ".html");
    const base = pathToFileURL(path.dirname(config.source) + path.sep).href;
    fs.writeFileSync(
      wrapper,
      `<!doctype html><base href="${base}"><script>${injection.replaceAll("</script", "<\\/script")}</script>${body}`,
    );
    await win.loadURL(pathToFileURL(wrapper).href);
    process.stderr.write(
      `Electron ${process.versions.electron} / Chromium ${process.versions.chrome}\n`,
    );
  })
  .catch((e) => {
    process.stderr.write(`${e.stack}\n`);
    stop();
    process.exitCode = 1;
  });

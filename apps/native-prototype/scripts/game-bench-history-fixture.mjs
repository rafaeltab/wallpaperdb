// Isolated UI contract tests: actual HTML/JS, in-memory jobs, no desktop daemon or game.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

export async function createHistoryFixture() {
  const records = new Map(
    [1, 2, 3].map((n) => {
      const id = `game-${n}000000000`;
      return [
        id,
        {
          id,
          name: "Studio wallpaper",
          created_ms: 1788897490910 + n,
          wallpaper: { id: "studio", title: "Studio wallpaper", kind: "image" },
          request: {
            source: "studio",
            game: "cs2",
            mode: "manual",
            experiment: "gpu",
            fps: 120,
            outputs: ["TEST-1"],
            game_output: "TEST-2",
            preset: "low",
            cap: 120,
            policy: "active",
          },
          status: {
            id,
            active: n === 3,
            state: n === 3 ? "running" : "stopped",
            phase: n === 3 ? "Recording control benchmark" : "Recording saved",
            recording: n === 3 ? "control" : null,
            wallpapers_restored: n !== 3,
          },
          result: n === 3 ? null : { runs: [], comparison: null },
          live: null,
        },
      ];
    }),
  );
  const mutations = [];
  let rejectNext = null;
  const snapshot = () => ({
    items: [
      {
        id: "studio",
        title: "Studio wallpaper",
        kind: "image",
        tags: [],
        description: "UI test",
      },
    ],
    groups: [],
    surfaces: [],
    audio: {},
    monitors: [
      { name: "TEST-1", width: 1440, height: 900, x: 0, y: 0, scale: 1 },
    ],
    ui_output: "TEST-1",
    benchmark: records.get("game-3000000000")?.status || {
      state: "idle",
      active: false,
    },
  });
  const assets = {
    "/": ["index.html", "text/html"],
    "/ui.css": ["style.css", "text/css"],
    "/ui.js": ["app.js", "text/javascript"],
    "/bench.js": ["bench.js", "text/javascript"],
  };
  const server = createServer(async (request, response) => {
    try {
      if (request.url !== "/api") {
        const asset = assets[request.url];
        if (!asset) {
          response.writeHead(404).end();
          return;
        }
        response.writeHead(200, { "Content-Type": asset[1] });
        response.end(
          readFileSync(new URL(`../ui/${asset[0]}`, import.meta.url)),
        );
        return;
      }
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const message = JSON.parse(Buffer.concat(chunks).toString());
      const record = records.get(message.id);
      let result;
      if (message.op === "status") result = snapshot();
      else if (message.op === "bench_history")
        result = { benchmarks: [...records.values()] };
      else if (["bench_record", "bench_live"].includes(message.op)) {
        assert.ok(record, "Benchmark is missing");
        result = record;
      } else if (["bench_rename", "bench_delete"].includes(message.op)) {
        mutations.push(message);
        if (rejectNext === message.op) {
          rejectNext = null;
          throw new Error("Could not save this change; try again");
        }
        assert.ok(record, "Benchmark is missing");
        if (message.op === "bench_rename") {
          record.name = message.name;
          result = record;
        } else {
          assert.equal(
            record.status.active,
            false,
            "Cannot delete a running benchmark",
          );
          records.delete(message.id);
          result = snapshot();
        }
      } else throw new Error(`Unexpected UI operation: ${message.op}`);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(result));
    } catch (error) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  server.unref();
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
    async verify({ js, until, call, screenshot }) {
      const click = (selector) =>
        js(`document.querySelector(${JSON.stringify(selector)}).click()`);
      const history = async () => {
        await click("#bench-nav");
        await until(
          "!document.querySelector('#bench-history').hidden && document.querySelectorAll('.bench-history-card').length > 0",
        );
      };
      const open = async (id) => {
        await history();
        await click(`.bench-history-card[data-id="${id}"]`);
        await until(
          "!document.querySelector('#bench-detail').hidden && !document.querySelector('#bench-rename').disabled",
        );
      };
      const submit = (name) =>
        js(
          `document.querySelector('#bench-name').value=${JSON.stringify(name)};document.querySelector('#bench-rename-form').requestSubmit()`,
        );
      await until("typeof state !== 'undefined' && state.items.length > 0");
      await open("game-1000000000");
      await click("#bench-rename");
      assert.equal(await js("document.activeElement.id"), "bench-name");
      assert.equal(
        await js("document.querySelector('#bench-name').value"),
        "Studio wallpaper",
      );
      await submit("   ");
      await until(
        "document.querySelector('#bench-manage-error').textContent.length > 0",
      );
      assert.equal(mutations.length, 0, "Blank name must not be submitted");
      rejectNext = "bench_rename";
      await submit("A failed rename");
      await until(
        "document.querySelector('#bench-manage-error').textContent.includes('try again')",
      );
      assert.equal(records.get("game-1000000000").name, "Studio wallpaper");
      assert.equal(
        await js("document.querySelector('#bench-name-save').disabled"),
        false,
      );
      const name = "Evening <b>🌙</b>";
      await submit(`  ${name}  `);
      await until("document.querySelector('#bench-manage').hidden");
      assert.equal(
        await js("document.querySelector('#bench-browser-title').textContent"),
        name,
      );
      assert.equal(
        await js(
          "document.querySelector('#bench-browser-title').childElementCount",
        ),
        0,
        "Names are text, not HTML",
      );
      assert.equal(mutations.at(-1).name, name);
      await call("Page.reload");
      await until("typeof state !== 'undefined' && state.items.length > 0");
      await history();
      assert.equal(
        await js(
          "document.querySelector('.bench-history-card[data-id=\"game-1000000000\"] strong').textContent",
        ),
        name,
      );
      assert.equal(
        await js(
          "document.querySelector('.bench-history-card[data-id=\"game-1000000000\"]').textContent.includes('Studio wallpaper')",
        ),
        true,
      );
      await open("game-3000000000");
      assert.equal(
        await js("document.querySelector('#bench-delete').disabled"),
        true,
      );
      await click("#bench-rename");
      await submit("Live session");
      await until("document.querySelector('#bench-manage').hidden");
      assert.equal(records.get("game-3000000000").name, "Live session");
      assert.equal(records.get("game-3000000000").status.active, true);
      await open("game-1000000000");
      await click("#bench-delete");
      assert.equal(
        await js("document.querySelector('#bench-delete-name').textContent"),
        name,
      );
      assert.equal(
        await js("document.activeElement.id"),
        "bench-delete-cancel",
      );
      assert.equal(mutations.filter((m) => m.op === "bench_delete").length, 0);
      await screenshot("game-bench-delete-confirm.png");
      await call("Emulation.setDeviceMetricsOverride", {
        width: 700,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      assert.equal(
        await js(
          "document.querySelector('#bench-browser').scrollWidth <= document.querySelector('#bench-browser').clientWidth",
        ),
        true,
      );
      assert.equal(
        await js(
          "document.querySelector('#bench-delete-confirm').getBoundingClientRect().height >= 36",
        ),
        true,
      );
      await screenshot("game-bench-delete-compact.png");
      await call("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await click("#bench-delete-cancel");
      assert.equal(records.size, 3);
      await click("#bench-delete");
      rejectNext = "bench_delete";
      await click("#bench-delete-confirm");
      await until(
        "document.querySelector('#bench-manage-error').textContent.includes('try again')",
      );
      assert.equal(records.size, 3);
      assert.equal(
        await js("document.querySelector('#bench-delete-confirm').disabled"),
        false,
      );
      await click("#bench-delete-confirm");
      await until(
        "!document.querySelector('#bench-history').hidden && document.querySelectorAll('.bench-history-card').length === 2",
      );
      assert.equal(records.has("game-1000000000"), false);
      assert.equal(records.has("game-3000000000"), true);
      assert.equal(
        await js(
          "document.querySelector('.bench-history-card[data-id=\"game-1000000000\"]') === null",
        ),
        true,
      );
      for (const id of ["game-2000000000", "game-3000000000"]) {
        records.get(id).status.active = false;
        await open(id);
        await click("#bench-delete");
        await click("#bench-delete-confirm");
        await until("!document.querySelector('#bench-history').hidden");
      }
      await until(
        "!document.querySelector('#bench-history-empty').hidden && document.querySelectorAll('.bench-history-card').length === 0",
      );
      console.log(
        "History rename/delete UI verified with isolated fixtures, including reload, active-run protection, confirmation, errors and empty history",
      );
    },
  };
}

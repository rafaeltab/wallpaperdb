import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { allStacksHealthy } from "./lib/boat-sample.mjs";

const execute = promisify(execFile);
const sampler = fileURLToPath(new URL("./boat-sample.mjs", import.meta.url));
const issues = [547, 548, 551, 553, 554];
const routes = [
	"/web/",
	"/ingestor/ready",
	"/asset/ready",
	"/wallpaper/ready",
	"/gateway/ready",
	"/variant-generator/ready",
	"/color-extractor/ready",
	"/user/ready",
];

for (const count of [1, 2, 3, 4, 5]) {
	test(`measurement accepts ${count} unique selected issues regardless of result order`, () => {
		const tasks = issues.slice(0, count).map((issue) => ({ issue }));
		const stacks = tasks
			.map(({ issue }) => ({ issue, healthy: true }))
			.reverse();
		assert.equal(allStacksHealthy(tasks, stacks), true);
	});
}

test("measurement accepts a selected issue outside the historical inventory", () => {
	assert.equal(
		allStacksHealthy([{ issue: 999 }], [{ issue: 999, healthy: true }]),
		true,
	);
});

test("measurement rejects a different issue identity without coercion", () => {
	assert.equal(
		allStacksHealthy([{ issue: 547 }], [{ issue: "547", healthy: true }]),
		false,
	);
});

const tasks = issues.map((issue) => ({ issue }));
const healthy = issues.map((issue) => ({ issue, healthy: true }));
for (const [name, selected, stacks] of [
	["empty inventory", [], []],
	["empty inventory with stale healthy results", [], healthy],
	["duplicate selected issue", [...tasks.slice(0, 4), tasks[3]], healthy],
	["missing stack", tasks, healthy.slice(0, 4)],
	["no stacks", tasks, []],
	["duplicate observed issue", tasks, [...healthy.slice(0, 4), healthy[3]]],
	[
		"unexpected issue replacing a selected one",
		tasks,
		[...healthy.slice(0, 4), { issue: 999, healthy: true }],
	],
	[
		"extra unexpected stack",
		tasks,
		[...healthy, { issue: 999, healthy: true }],
	],
	[
		"unhealthy stack",
		tasks,
		[...healthy.slice(0, 4), { issue: 554, healthy: false }],
	],
	["missing health result", tasks, [...healthy.slice(0, 4), { issue: 554 }]],
]) {
	test(`measurement fails for ${name}`, () => {
		assert.equal(allStacksHealthy(selected, stacks), false);
	});
}

async function sampleInventory(
	t,
	selected,
	{ stopped = false, failedRoute } = {},
) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "boat-sample-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const requests = [];
	const server = http.createServer((req, res) => {
		requests.push(req.url);
		res.writeHead(req.url === failedRoute ? 503 : 200);
		res.end("controlled readiness");
	});
	t.after(() => {
		server.closeAllConnections();
		server.close();
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const workerLog = path.join(root, "worker-calls.jsonl");
	fs.writeFileSync(workerLog, "");
	const tasks = selected.map((issue, index) => {
		const worktreePath = path.join(root, `worktree-${index}`);
		fs.mkdirSync(path.join(worktreePath, ".boat"), { recursive: true });
		fs.mkdirSync(path.join(worktreePath, ".mise/boat"), { recursive: true });
		fs.writeFileSync(
			path.join(worktreePath, ".boat/state.json"),
			JSON.stringify({
				id: `controlled-${index}`,
				runningSince: stopped ? null : 1,
			}),
		);
		if (!stopped)
			fs.writeFileSync(
				path.join(worktreePath, ".worktree"),
				`INGRESS_PORT = ${server.address().port}\n`,
			);
		fs.writeFileSync(
			path.join(worktreePath, ".mise/boat/boat"),
			`#!${process.execPath}\nrequire("node:fs").appendFileSync(process.env.BOAT_SAMPLE_TEST_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");\nconsole.log("controlled worker sample");\n`,
			{ mode: 0o700 },
		);
		return { issue, worktreePath };
	});
	const inventory = path.join(root, "tasks.json");
	const output = path.join(root, "samples");
	fs.writeFileSync(inventory, JSON.stringify(tasks));
	const states = () =>
		tasks.map((task) =>
			fs.readFileSync(path.join(task.worktreePath, ".boat/state.json"), "utf8"),
		);
	const statesBefore = states();
	await execute(process.execPath, [sampler, inventory, output, "--once"], {
		env: { ...process.env, BOAT_SAMPLE_TEST_LOG: workerLog },
		timeout: 10000,
	});
	assert.deepEqual(states(), statesBefore);
	const records = fs
		.readFileSync(path.join(output, "aligned-samples.jsonl"), "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	assert.equal(records.length, 1);
	return {
		record: records[0],
		requests,
		workerCalls: fs
			.readFileSync(workerLog, "utf8")
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line)),
	};
}

for (const count of [1, 2, 3, 4, 5]) {
	test(`CLI accepts exactly ${count} selected healthy issues`, async (t) => {
		const selected = issues.slice(0, count);
		const { record, requests, workerCalls } = await sampleInventory(
			t,
			selected,
		);
		assert.deepEqual(
			record.stacks.map((stack) => stack.issue),
			selected,
		);
		assert.equal(record.allHealthy, true);
		for (const stack of record.stacks) {
			assert.equal(stack.healthy, true);
			assert.deepEqual(
				stack.health,
				routes.map((route) => ({ route, status: 200 })),
			);
			assert.equal(stack.worker.stdout, "controlled worker sample\n");
		}
		assert.deepEqual(
			requests.sort(),
			Array.from({ length: count }, () => routes)
				.flat()
				.sort(),
		);
		assert.equal(workerCalls.length, count);
		for (const args of workerCalls) {
			assert.deepEqual(args.slice(0, 2), ["--no-update", "ssh"]);
			assert.match(args[2], /^controlled-\d$/);
			assert.deepEqual(args.slice(3), [
				"--",
				"bash",
				"-lc",
				"date -u; cat /proc/stat /proc/meminfo; df -k /; cat /proc/pressure/cpu /proc/pressure/memory /proc/pressure/io",
			]);
		}
	});
}

test("CLI never passes an empty selected inventory", async (t) => {
	const { record, requests, workerCalls } = await sampleInventory(t, []);
	assert.equal(record.allHealthy, false);
	assert.deepEqual(record.stacks, []);
	assert.deepEqual(requests, []);
	assert.deepEqual(workerCalls, []);
});

test("CLI rejects duplicate issue inventory even with five healthy stacks", async (t) => {
	const { record } = await sampleInventory(t, [547, 548, 551, 553, 553]);
	assert.equal(record.allHealthy, false);
});

test("CLI reports a failed real readiness route as unhealthy", async (t) => {
	const { record } = await sampleInventory(t, issues, {
		failedRoute: "/asset/ready",
	});
	assert.equal(record.allHealthy, false);
	assert.ok(record.stacks.every((stack) => stack.healthy === false));
	assert.deepEqual(
		record.stacks[0].health.find((probe) => probe.route === "/asset/ready"),
		{ route: "/asset/ready", status: 503 },
	);
});

test("CLI sampling a stopped worker performs no readiness or Boat calls", async (t) => {
	const { record, requests, workerCalls } = await sampleInventory(t, [547], {
		stopped: true,
	});
	assert.equal(record.allHealthy, false);
	assert.equal(record.stacks[0].stopped, true);
	assert.equal(record.stacks[0].healthy, false);
	assert.deepEqual(requests, []);
	assert.deepEqual(workerCalls, []);
});

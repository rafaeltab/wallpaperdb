import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { captureCommand } from "./boat-capture.mjs";
import net from "node:net";

const helper = fileURLToPath(
	new URL("boat-engine-baseline.mjs", import.meta.url),
);

for (const changed of [false, true])
	test(`Engine worker helper ${changed ? "refuses changed" : "accepts exact"} source authority before endpoint access`, async (t) => {
		const directory = fs.mkdtempSync(
			path.join(os.tmpdir(), "boat-engine-helper-"),
		);
		t.after(() => {
			fs.rmSync(directory, { recursive: true });
			assert.equal(fs.existsSync(directory), false);
			t.diagnostic(JSON.stringify({ fixture: directory, removed: true }));
		});
		const bytes = fs.readFileSync(helper);
		const expected = {
			path: "scripts/lib/boat-engine-baseline.mjs",
			bytes: bytes.length,
			sha256: changed
				? "0".repeat(64)
				: createHash("sha256").update(bytes).digest("hex"),
			mode: fs.statSync(helper).mode & 0o777,
		};
		const owner = {
			version: "547-engine-baseline-v1",
			root: directory,
			round: "worker-source-control",
			worker: "fixture-worker",
			admission: "fixture-admission",
		};
		const receipt = await captureCommand({
			argv: [
				process.execPath,
				helper,
				"--worker",
				JSON.stringify(owner),
				JSON.stringify(expected),
			],
			cwd: directory,
			directory: path.join(directory, "capture"),
			deadline: Number(process.hrtime.bigint()) / 1e9 + 2,
			disposalMs: 1000,
			limit: 32768,
			env: {
				...process.env,
				WALLPAPERDB_BOAT_WORKER: "1",
				DOCKER_HOST: `unix://${directory}/absent-owned-endpoint`,
			},
		});
		const disposal = JSON.parse(
			fs.readFileSync(path.join(directory, "capture/disposal.json")),
		);
		const stdout = fs.readFileSync(
			path.join(directory, "capture/stdout.raw"),
			"utf8",
		);
		const stderr = fs.readFileSync(
			path.join(directory, "capture/stderr.raw"),
			"utf8",
		);
		t.diagnostic(JSON.stringify({ receipt, disposal, stdout, stderr }));
		assert.equal(receipt.captureComplete, true);
		assert.deepEqual(disposal.unresolved, []);
		assert.equal(disposal.pipesClosed, true);
		assert.deepEqual(receipt.terminal, { code: changed ? 1 : 0, signal: null });
		if (changed) {
			assert.equal(stdout, "");
			assert.equal(stderr, "Engine baseline worker helper changed\n");
		} else {
			assert.match(stdout, /^BOAT_ENGINE_VERSION_V1 /);
			assert.equal(
				JSON.parse(stdout.slice("BOAT_ENGINE_VERSION_V1 ".length)).status,
				"UNAVAILABLE_ENDPOINT",
			);
		}
	});

for (const [description, setupFailure, cleanupFailure] of [
	["config refusal retires its acquired temporary directory", true, false],
	["config refusal preserves both setup and cleanup errors", true, true],
	["native failure preserves its evidence when cleanup fails", false, true],
])
	test(`Engine worker ${description}`, async (t) => {
		const directory = fs.mkdtempSync(
			path.join(os.tmpdir(), "boat-engine-setup-"),
		);
		let server;
		t.after(async () => {
			if (server?.listening)
				await new Promise((resolve, reject) =>
					server.close((error) => (error ? reject(error) : resolve())),
				);
			fs.rmSync(directory, { recursive: true });
			assert.equal(fs.existsSync(directory), false);
			t.diagnostic(JSON.stringify({ fixture: directory, removed: true }));
		});
		const socket = path.join(directory, "engine.sock");
		let connections = 0;
		server = net.createServer((connection) => {
			connections++;
			connection.destroy();
		});
		await new Promise((resolve, reject) => {
			server.once("error", reject);
			server.listen(socket, resolve);
		});
		const source = path.join(directory, "source-config");
		fs.mkdirSync(source);
		fs.writeFileSync(
			path.join(source, "config.json"),
			'{"auths":{},"currentContext":"default"}',
		);
		const hook = path.join(directory, "setup-refusal.cjs");
		fs.writeFileSync(
			hook,
			`const fs=require('node:fs'),path=require('node:path');const write=fs.writeFileSync,remove=fs.rmSync;
const prefix=${JSON.stringify(path.join(directory, ".boat/engine-version-"))};
fs.writeFileSync=function(file,...args){if(${setupFailure}&&String(file).startsWith(prefix)&&path.basename(file)==='config.json'){write.call(this,file,'CONTROL_PARTIAL_CONFIG');write.call(this,${JSON.stringify(path.join(directory, "fault-entered"))},'setup');throw Object.assign(new Error('CONTROL_CONFIG_ENOSPC'),{code:'ENOSPC'});}return write.call(this,file,...args);};
fs.rmSync=function(file,...args){if(${cleanupFailure}&&String(file).startsWith(prefix)){write.call(this,${JSON.stringify(path.join(directory, "cleanup-fault-entered"))},'cleanup');throw new Error('CONTROL_CLEANUP_EACCES');}return remove.call(this,file,...args);};\n`,
		);
		if (!setupFailure) {
			// Controlled native Make failure, not a Docker formatter/API success.
			fs.writeFileSync(
				path.join(directory, "Makefile"),
				"docker-run:\n\t@printf 'CONTROL_NATIVE_FAILURE\\n'; exit 17\n",
			);
		}
		const bytes = fs.readFileSync(helper);
		const expected = {
			path: "scripts/lib/boat-engine-baseline.mjs",
			bytes: bytes.length,
			sha256: createHash("sha256").update(bytes).digest("hex"),
			mode: fs.statSync(helper).mode & 0o777,
		};
		const env = {
			...process.env,
			WALLPAPERDB_BOAT_WORKER: "1",
			DOCKER_HOST: `unix://${socket}`,
			DOCKER_CONFIG: source,
			WALLPAPERDB_DOCKER_SOURCE_CONFIG: source,
			NODE_OPTIONS: `--require=${hook}`,
		};
		for (const name of [
			"DOCKER_CONTEXT",
			"DOCKER_TLS",
			"DOCKER_TLS_VERIFY",
			"DOCKER_CERT_PATH",
			"DOCKER_CUSTOM_HEADERS",
			"DOCKER_API_VERSION",
		])
			delete env[name];
		const receipt = await captureCommand({
			argv: [
				process.execPath,
				helper,
				"--worker",
				JSON.stringify({
					round: "setup-refusal",
					worker: "fixture-worker",
					admission: "fixture-admission",
				}),
				JSON.stringify(expected),
			],
			cwd: directory,
			env,
			directory: path.join(directory, "capture"),
			deadline: Number(process.hrtime.bigint()) / 1e9 + 2,
			disposalMs: 1000,
			limit: 32768,
		});
		const stdout = fs.readFileSync(
				path.join(directory, "capture/stdout.raw"),
				"utf8",
			),
			stderr = fs.readFileSync(
				path.join(directory, "capture/stderr.raw"),
				"utf8",
			),
			disposal = JSON.parse(
				fs.readFileSync(path.join(directory, "capture/disposal.json")),
			);
		const remaining = fs
			.readdirSync(path.join(directory, ".boat"))
			.filter((name) => name.startsWith("engine-version-"));
		t.diagnostic(
			JSON.stringify({
				receipt,
				disposal,
				stdout,
				stderr,
				remaining,
				connections,
				faultEntered: fs.existsSync(path.join(directory, "fault-entered")),
				cleanupFaultEntered: fs.existsSync(
					path.join(directory, "cleanup-fault-entered"),
				),
			}),
		);
		assert.equal(receipt.captureComplete, true);
		assert.deepEqual(receipt.terminal, { code: 1, signal: null });
		assert.equal(disposal.pipesClosed, true);
		assert.deepEqual(disposal.unresolved, []);
		assert.equal(connections, 0);
		assert.equal(
			fs.existsSync(path.join(directory, "fault-entered")),
			setupFailure,
		);
		if (setupFailure) {
			assert.equal(stdout, "");
			assert.match(stderr, /CONTROL_CONFIG_ENOSPC/);
		} else {
			const observation = JSON.parse(
				stdout.slice("BOAT_ENGINE_VERSION_V1 ".length),
			);
			assert.equal(observation.closed, false);
			assert.equal(observation.status, "UNRESOLVED");
			assert.deepEqual(observation.child.terminal, { code: 2, signal: null });
			assert.equal(observation.child.pipesClosed, true);
			assert.deepEqual(observation.child.unresolved, []);
			assert.match(
				Buffer.from(observation.stdout, "base64").toString(),
				/CONTROL_NATIVE_FAILURE/,
			);
			assert.match(
				Buffer.from(observation.stderr, "base64").toString(),
				/Error 17/,
			);
		}
		if (cleanupFailure) {
			assert.equal(
				fs.existsSync(path.join(directory, "cleanup-fault-entered")),
				true,
			);
			assert.match(stderr, /CONTROL_CLEANUP_EACCES/);
			assert.equal(
				remaining.length,
				1,
				"Failed removal remains explicit until the independent fixture owner retires it",
			);
		} else assert.deepEqual(remaining, []);
	});

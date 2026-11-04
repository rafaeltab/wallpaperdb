import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { once } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const repository = path.resolve(import.meta.dirname, "../..");
const require = createRequire(repository + "/apps/web/package.json");
const { makeCommand } = await import(
	pathToFileURL(repository + "/scripts/lib/boat-hillclimb.mjs")
);
const { captureServingCommand } = await import(
	pathToFileURL(repository + "/scripts/lib/boat-capture.mjs")
);
const { generatedAuthority } = await import(
	pathToFileURL(repository + "/scripts/lib/boat-preparation.mjs")
);
const mono = () => Number(process.hrtime.bigint()) / 1e9;
const sha = (b) => createHash("sha256").update(b).digest("hex");
const pin = (p) => ({
	path: p,
	bytes: fs.statSync(p).size,
	sha256: sha(fs.readFileSync(p)),
});
function bound(promise, seconds, label) {
	let timer;
	return Promise.race([
		promise,
		new Promise((_, reject) => {
			timer = setTimeout(
				() => reject(Error(label + " deadline")),
				seconds * 1000,
			);
		}),
	]).finally(() => clearTimeout(timer));
}
async function until(predicate, seconds, label) {
	const deadline = mono() + seconds;
	while (mono() < deadline) {
		const value = await predicate();
		if (value) return value;
		await new Promise((r) => setTimeout(r, 20));
	}
	throw Error(label + " deadline");
}
export async function previewViteControl(t, helpers) {
	const evidenceDirectory = fs.mkdtempSync(
		path.join(
			process.env.BOAT_PREVIEW_BROWSER_EVIDENCE ?? os.tmpdir(),
			"vite-preview-",
		),
	);
	const save = (name, value) => {
		const fd = fs.openSync(path.join(evidenceDirectory, name), "wx", 0o600);
		try {
			fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n");
			fs.fsyncSync(fd);
		} finally {
			fs.closeSync(fd);
		}
	};

	t.diagnostic("Actual-client evidence: " + evidenceDirectory);
	const origin = mono(),
		hooks = [],
		handles = [],
		servers = [],
		events = [],
		previewEnds = new Map();
	let f,
		vite,
		browserServer,
		browser,
		context,
		page,
		canary,
		canaryIdentity,
		canaryPort,
		caseTimer;
	let phase = "SETUP",
		stage = "fixture",
		failure,
		target,
		cleanupFailure;
	const record = (kind, data = {}) => {
		const e = {
			at: new Date().toISOString(),
			mono: mono(),
			phase,
			kind,
			...data,
		};
		events.push(e);
		fs.appendFileSync(
			path.join(evidenceDirectory, "events.jsonl"),
			JSON.stringify(e) + "\n",
			{
				mode: 0o600,
			},
		);
	};
	const owner = {
		after: (fn) => hooks.push(fn),
		diagnostic: (text) => record("fixture-diagnostic", { text }),
	};
	const live = helpers.fixtureProcess;
	const liveness = new Promise((_, reject) => {
		caseTimer = setTimeout(
			() => reject(Error("Independent110-second case liveness deadline")),
			110000,
		);
	});
	const body = (async () => {
		f = await helpers.lockGenerationCheckout(owner, {
			directory: path.join(evidenceDirectory, "fixture"),
			cleanupReport: path.join(evidenceDirectory, "fixture-native"),
			captureStreams: true,
			ownPackageGroups: true,
		});
		const production = [
			"Makefile",
			"scripts/boat-route.mk",
			"scripts/boat.mjs",
			"scripts/lib/boat-preview.mjs",
			"scripts/lib/boat.mjs",
		];
		const productionPins = production.map((n) => {
			assert.deepEqual(
				fs.readFileSync(path.join(f.root, n)),
				fs.readFileSync(path.join(repository, n)),
			);
			return pin(path.join(repository, n));
		});
		delete f.env.MAKEFILES;
		delete f.env.GNUMAKEFLAGS;
		fs.copyFileSync(
			path.join(import.meta.dirname, "preview-vite-boat.cjs"),
			path.join(f.root, ".mise/boat/boat"),
		);
		fs.chmodSync(path.join(f.root, ".mise/boat/boat"), 0o700);
		for (const n of ["boat", "ssh", "curl", "wget"])
			fs.writeFileSync(
				path.join(f.directory, "home/.local/bin", n),
				"#!/bin/sh\nexit 96\n",
				{ mode: 0o700 },
			);
		const reserve = async (port = 0) => {
			const s = net.createServer();
			servers.push(s);
			s.listen(port, "127.0.0.1");
			await bound(once(s, "listening"), 3, "Port reservation");
			return s;
		};
		const privateLease = await reserve();
		const privatePort = privateLease.address().port;
		const publicPort = privatePort - 20000;
		assert.ok(publicPort > 0);
		const publicLease = await reserve(publicPort);
		const viteLease = await reserve();
		const vitePort = viteLease.address().port;
		const site = path.join(evidenceDirectory, "site");
		fs.mkdirSync(site, { mode: 0o700 });
		fs.writeFileSync(
			path.join(site, "index.html"),
			"<!doctype html><html><head><title>Vite preview control</title></head><body><h1>Actual Vite control</h1><p id=source></p><script type=module src=/source.js></script></body></html>",
			{ mode: 0o600 },
		);
		const sourcePath = path.join(site, "source.js");
		const source = (value) =>
			`export const value=${JSON.stringify(value)};document.querySelector('#source').textContent=value;if(import.meta.hot)import.meta.hot.accept(m=>{document.querySelector('#source').textContent=m.value;});`;
		fs.writeFileSync(sourcePath, source("A"));
		stage = "vite-setup";
		const viteModule = await import(pathToFileURL(require.resolve("vite")));
		const vitePackage = require("vite/package.json");
		assert.equal(vitePackage.version, "7.3.0");
		await new Promise((r) => viteLease.close(r));
		const startVite = async () => {
			const server = await bound(
				viteModule.createServer({
					configFile: false,
					root: site,
					cacheDir: path.join(evidenceDirectory, "private-vite-cache"),
					logLevel: "error",
					server: { host: "127.0.0.1", port: vitePort, strictPort: true },
				}),
				10,
				"Vite create",
			);
			server.httpServer.on("upgrade", (req) =>
				record("upstream-upgrade", {
					url: req.url,
					protocol: req.headers["sec-websocket-protocol"],
				}),
			);
			await bound(server.listen(), 10, "Vite listen");
			assert.equal(server.httpServer.address().port, vitePort);
			return server;
		};
		vite = await startVite();
		f.local(".worktree", `INGRESS_PORT=${publicPort}\n`);
		const authority = JSON.parse(
			fs.readFileSync(path.join(f.root, generatedAuthority[0])),
		);
		authority.identityProviders.clerk.authorizedParties = [
			`http://localhost:${publicPort}`,
			`http://127.0.0.1:${publicPort}`,
		];
		f.local(generatedAuthority[0], JSON.stringify(authority));
		Object.assign(f.env, {
			CONTROL_VITE_PORT: String(vitePort),
			CONTROL_PRIVATE_PORT: String(privatePort),
			CONTROL_PUBLIC_PORT: String(publicPort),
		});
		fs.mkdirSync(path.join(evidenceDirectory, "sibling"), { mode: 0o700 });
		canary = captureServingCommand({
			argv: [
				process.execPath,
				"-e",
				"const h=require('http').createServer((q,s)=>{if(q.url==='/finish'){s.end('sibling-finished');h.close(()=>process.exit(0));}else s.end('sibling-alive');});h.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:h.address().port})));process.on('SIGTERM',()=>h.close(()=>process.exit(0)));",
			],
			cwd: path.join(evidenceDirectory, "sibling"),
			directory: path.join(evidenceDirectory, "sibling-capture"),
		});
		await until(
			() => {
				try {
					const text = fs
						.readFileSync(
							path.join(evidenceDirectory, "sibling-capture/stdout.raw"),
							"utf8",
						)
						.trim();
					canaryPort = JSON.parse(text).port;
					return canaryPort;
				} catch {
					return false;
				}
			},
			3,
			"Sibling listen",
		);
		canaryIdentity = live(canary.pid);
		assert.ok(canaryIdentity);
		record("sibling-born", { identity: canaryIdentity, port: canaryPort });
		await Promise.all(
			[privateLease, publicLease].map((s) => new Promise((r) => s.close(r))),
		);
		const startPreview = async (name) => {
			const h = await makeCommand(
				[
					"make",
					"boat-preview",
					"BOAT_EXEC=local",
					"SHELL=/bin/sh",
					"boat_routed_goals=",
				],
				{
					cwd: f.root,
					env: f.env,
					directory: path.join(evidenceDirectory, name),
					serving: true,
				},
			);
			handles.push(h);
			void h.completion.then(
				(result) => previewEnds.set(h, { result }),
				(error) => previewEnds.set(h, { error }),
			);
			return h;
		};
		const requirePreviewRunning = (h, label) => {
			const ended = previewEnds.get(h);
			if (ended)
				throw Error(
					label +
						" command terminated before readiness: " +
						(ended.error?.message ?? JSON.stringify(ended.result?.terminal)),
				);
		};
		stage = "initial-preview";
		const oldHandle = await startPreview("initial-preview");
		const old = await until(
			() => {
				requirePreviewRunning(oldHandle, "Initial preview");
				const p = path.join(f.root, ".boat/preview-process.json");
				if (!fs.existsSync(p)) return false;
				const v = JSON.parse(fs.readFileSync(p));
				return v.ready && v.phase === "ready" && v;
			},
			15,
			"Initial preview ready",
		);
		record("old-preview-ready", { preview: old });
		stage = "browser";
		const pw = require("playwright");
		browserServer = await pw.chromium.launchServer({
			host: "127.0.0.1",
			headless: true,
			timeout: 10000,
		});
		const browserIdentity = live(browserServer.process().pid);
		record("browser-born", {
			identity: browserIdentity,
			version: pw.chromium.name(),
		});
		browser = await pw.chromium.connect(browserServer.wsEndpoint(), {
			timeout: 10000,
		});
		context = await browser.newContext({ serviceWorkers: "block" });
		page = await context.newPage();
		const cdp = await context.newCDPSession(page);
		await cdp.send("Network.enable");
		await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
		record("offline-capture-cache-disabled", { cacheDisabled: true });
		await cdp.send("Page.enable");
		await cdp.send("Runtime.enable");
		for (const name of [
			"Network.webSocketCreated",
			"Network.webSocketWillSendHandshakeRequest",
			"Network.webSocketHandshakeResponseReceived",
			"Network.webSocketFrameReceived",
			"Network.webSocketFrameSent",
			"Network.webSocketClosed",
			"Network.webSocketFrameError",
			"Page.frameNavigated",
			"Page.frameRequestedNavigation",
			"Page.frameScheduledNavigation",
			"Runtime.consoleAPICalled",
		])
			cdp.on(name, (data) => record(name, { data }));
		cdp.on("Network.requestWillBeSent", (data) => {
			if (data.type === "Document") record("document-request", { data });
		});
		page.on("console", (msg) =>
			record("console", {
				type: msg.type(),
				text: msg.text(),
				location: msg.location(),
			}),
		);
		page.on("pageerror", (error) =>
			record("pageerror", { text: error.message }),
		);
		const delivered = [];
		page.on("response", (response) => {
			if (new URL(response.url()).pathname === "/@vite/client")
				void response
					.body()
					.then((bytes) => {
						const n = delivered.length + 1,
							file = path.join(evidenceDirectory, `delivered-client-${n}.mjs`);
						fs.writeFileSync(file, bytes, { mode: 0o600 });
						const p = pin(file);
						delivered.push(p);
						record("actual-client-delivered", { ...p, url: response.url() });
					})
					.catch((error) =>
						record("client-body-error", { error: error.message }),
					);
		});
		await page.goto(`http://127.0.0.1:${publicPort}/`, {
			waitUntil: "load",
			timeout: 15000,
		});
		await until(
			() =>
				delivered.length &&
				events.some(
					(e) =>
						e.kind === "Network.webSocketFrameReceived" &&
						e.data.response.payloadData.includes('"type":"connected"'),
				),
			10,
			"Actual HMR connected",
		);
		const original = await page.evaluate((id) => {
			Object.defineProperty(window, "__controlOriginalDocument", {
				value: Object.freeze({ id, timeOrigin: performance.timeOrigin }),
				writable: false,
				configurable: false,
			});
			return {
				marker: window.__controlOriginalDocument,
				timeOrigin: performance.timeOrigin,
				immutable:
					!Object.getOwnPropertyDescriptor(window, "__controlOriginalDocument")
						.writable &&
					!Object.getOwnPropertyDescriptor(window, "__controlOriginalDocument")
						.configurable,
			};
		}, randomUUID());
		assert.ok(original.immutable);
		const connectedEvents = events.filter(
			(e) => e.kind === "Network.webSocketCreated",
		);
		assert.ok(
			connectedEvents.some(
				(e) => new URL(e.data.url).port === String(publicPort),
			),
		);
		phase = "UNINTERRUPTED_NEIGHBOR";
		stage = "neighbor";
		const nonce = randomUUID();
		vite.ws.send({
			type: "custom",
			event: "control-neighbor",
			data: { nonce },
		});
		await until(
			() =>
				events.some(
					(e) =>
						e.kind === "Network.webSocketFrameReceived" &&
						e.data.response.payloadData.includes(nonce),
				),
			5,
			"Neighbor HMR message",
		);
		const neighbor = await page.evaluate(() => ({
			marker: window.__controlOriginalDocument ?? null,
			timeOrigin: performance.timeOrigin,
		}));
		assert.deepEqual(neighbor, {
			marker: original.marker,
			timeOrigin: original.timeOrigin,
		});
		assert.ok(!events.some((e) => e.kind === "Network.webSocketClosed"));
		record("neighbor-PASS", { original, neighbor });
		const clientPath = path.join(
			path.dirname(require.resolve("vite/package.json")),
			"dist/client/client.mjs",
		);
		save("actual-client-identity.json", {
			version: vitePackage.version,
			package: pin(require.resolve("vite/package.json")),
			source: pin(clientPath),
			nodeEntry: pin(require.resolve("vite")),
			deliveredBefore: delivered[0],
			productionPins,
			ports: { publicPort, privatePort, vitePort },
			browser: {
				version: browser.version(),
				executable: pw.chromium.executablePath(),
				identity: browserIdentity,
			},
			original,
			neighbor,
		});
		phase = "HANDOVER";
		stage = "handover";
		record("trigger-one-ordinary-preview-replacement", {
			oldGeneration: old.generation,
		});
		const newHandle = await startPreview("replacement-preview");
		const current = await until(
			() => {
				requirePreviewRunning(newHandle, "Replacement preview");
				let p;
				try {
					p = JSON.parse(
						fs.readFileSync(path.join(f.root, ".boat/preview-process.json")),
					);
				} catch (error) {
					if (error.code === "ENOENT") return false;
					throw error;
				}
				return p.ready && p.generation !== old.generation && p;
			},
			20,
			"New preview ready",
		);
		const oldCompletion = await bound(
			oldHandle.completion,
			5,
			"Old capture terminal/drain",
		);
		assert.ok(oldCompletion.captureComplete);
		const oldDisposal = JSON.parse(
			fs.readFileSync(
				path.join(evidenceDirectory, "initial-preview/disposal.json"),
			),
		);
		assert.equal(oldDisposal.pipesClosed, true);
		assert.deepEqual(oldDisposal.unresolved, []);
		assert.notEqual(current.pid, old.pid);
		assert.notEqual(current.forward.pid, old.forward.pid);
		record("new-preview-ready", { preview: current });
		const afterNonce = randomUUID();
		vite.ws.send({
			type: "custom",
			event: "control-after-replacement",
			data: { nonce: afterNonce },
		});
		await until(
			() =>
				events.some(
					(e) =>
						e.phase === "HANDOVER" &&
						e.kind === "Network.webSocketFrameReceived" &&
						e.data.response.payloadData.includes(afterNonce),
				) ||
				events.some(
					(e) => e.phase === "HANDOVER" && e.kind === "Page.frameNavigated",
				),
			10,
			"HMR or document navigation after replacement",
		);
		const after = await page.evaluate(() => ({
			marker: window.__controlOriginalDocument ?? null,
			timeOrigin: performance.timeOrigin,
		}));
		save("original-document-target.json", { original, neighbor, after });
		assert.deepEqual(
			after,
			{ marker: original.marker, timeOrigin: original.timeOrigin },
			"Original document must survive preview handover",
		);
		assert.equal(
			events.filter(
				(e) => e.phase === "HANDOVER" && e.kind === "Network.webSocketClosed",
			).length,
			0,
			"Replacement must preserve the actual HMR socket",
		);
		// Exercise the same real client after replacement, not only a custom frame.
		fs.writeFileSync(sourcePath, source("B"));
		await until(
			async () => (await page.locator("#source").textContent()) === "B",
			10,
			"Real source HMR after replacement",
		);
		const presence = path.join(site, "presence.txt");
		const payload = "BOAT-547-PRESENCE\n";
		const getPresence = () =>
			page.evaluate(async () => {
				const r = await fetch("/presence.txt", {
					cache: "no-store",
					credentials: "omit",
					headers: { Accept: "text/plain" },
				});
				return { status: r.status, body: await r.text() };
			});
		fs.writeFileSync(presence, payload, { flag: "wx", mode: 0o600 });
		assert.deepEqual(await getPresence(), { status: 200, body: payload });
		fs.unlinkSync(presence);
		await until(
			async () => {
				const r = await getPresence();
				return r.status === 404 && r.body === "";
			},
			10,
			"Deletion through new preview",
		);
		const retained = await page.evaluate(() => ({
			marker: window.__controlOriginalDocument ?? null,
			timeOrigin: performance.timeOrigin,
		}));
		assert.deepEqual(retained, {
			marker: original.marker,
			timeOrigin: original.timeOrigin,
		});
		const directClient = Buffer.from(
			await (
				await fetch(`http://127.0.0.1:${vitePort}/@vite/client`)
			).arrayBuffer(),
		);
		assert.equal(
			delivered[0].sha256,
			sha(directClient),
			"Delivered client equals actual native Vite response",
		);
		// A real full-reload message must still navigate; no reload interception.
		phase = "GENUINE_FULL_RELOAD";
		const navigation = page.waitForEvent("load", { timeout: 10000 });
		vite.ws.send({ type: "full-reload", path: "*" });
		await navigation;
		const reloaded = await page.evaluate(() => ({
			marker: window.__controlOriginalDocument ?? null,
			timeOrigin: performance.timeOrigin,
		}));
		assert.equal(reloaded.marker, null);
		assert.notEqual(reloaded.timeOrigin, original.timeOrigin);
		await until(
			() =>
				events.some(
					(e) =>
						e.phase === "GENUINE_FULL_RELOAD" &&
						e.kind === "Network.webSocketFrameReceived" &&
						e.data.response.payloadData.includes('"type":"connected"'),
				),
			10,
			"HMR after genuine full reload",
		);
		phase = "GENUINE_SERVER_RESTART";
		const restartNavigation = page.waitForEvent("load", { timeout: 15000 });
		await bound(vite.close(), 10, "Genuine Vite stop");
		await until(
			() =>
				events.some(
					(e) =>
						e.phase === phase &&
						e.kind === "console" &&
						e.text.includes("server connection lost"),
				),
			10,
			"Native Vite disconnect",
		);
		vite = await startVite();
		await restartNavigation;
		const restartedOrigin = await page.evaluate(() => performance.timeOrigin);
		assert.notEqual(
			restartedOrigin,
			reloaded.timeOrigin,
			"Real server restart still reloads",
		);
		await until(
			() =>
				events.some(
					(e) =>
						e.phase === phase &&
						e.kind === "Network.webSocketFrameReceived" &&
						e.data.response.payloadData.includes('"type":"connected"'),
				),
			10,
			"HMR after real server restart",
		);
		assert.ok(
			events.some(
				(e) =>
					e.phase === phase &&
					e.kind === "document-request" &&
					e.data.initiator.type === "script",
			),
		);
		const roleDirectory = path.join(f.root, ".boat/preview-connections");
		const roles = () =>
			fs.existsSync(roleDirectory)
				? fs.readdirSync(roleDirectory).map((n) => ({
						directory: path.join(roleDirectory, n),
						...JSON.parse(
							fs.readFileSync(path.join(roleDirectory, n, "connection.json")),
						),
					}))
				: [];
		const active = roles().filter((r) => r.phase === "serving");
		assert.equal(active.length, 1);
		assert.notEqual(active[0].pid, old.pid);
		assert.notEqual(active[0].pid, current.pid);
		// Managed cleanup retires the HTTP capture, then ordinary guarded stop owns
		// the remaining development connections before the controlled stop request.
		await bound(newHandle.stop(), 10, "Current preview capture retirement");
		const stopped = await makeCommand(
			[
				"make",
				"boat-stop",
				"BOAT_EXEC=local",
				"SHELL=/bin/sh",
				"boat_routed_goals=",
			],
			{
				cwd: f.root,
				env: f.env,
				directory: path.join(evidenceDirectory, "owning-stop"),
				deadline: Math.min(origin + 110, mono() + 20),
			},
		);
		assert.deepEqual(stopped.terminal, { code: 0, signal: null });
		assert.ok(stopped.captureComplete);
		const stopDisposal = JSON.parse(
			fs.readFileSync(
				path.join(evidenceDirectory, "owning-stop/disposal.json"),
			),
		);
		assert.equal(stopDisposal.pipesClosed, true);
		assert.deepEqual(stopDisposal.unresolved, []);
		const stopEvents = fs
			.readFileSync(path.join(f.control, "offline-transport.jsonl"), "utf8")
			.trim()
			.split("\n")
			.map(JSON.parse)
			.filter((e) => e.kind === "controlled-stop");
		assert.equal(stopEvents.length, 1);
		assert.deepEqual(stopEvents[0].live, []);
		const settled = f.json(".boat/state.json");
		assert.equal(settled.runningSince, null);
		assert.ok(settled.shutdownAttempt.accountingAppliedAt);
		save("ordinary-stop-result.json", {
			stopped,
			stopDisposal,
			stopEvents,
			accounting: settled.shutdownAttempt,
		});

		assert.ok(roles().every((r) => helpers.fixtureProcess(r.pid) === null));
		const retiredRoles = roles().map((role) => {
			const raw = fs.readFileSync(
				path.join(role.directory, "events.jsonl"),
				"utf8",
			);
			const native = raw.trim().split("\n").map(JSON.parse);
			const retired = native.findLast((e) => e.stage === "retired");
			assert.equal(retired?.closed, true);
			assert.deepEqual(retired.terminal, { code: 0, signal: null });
			assert.equal(role.phase, "closed");
			assert.equal(
				fs.existsSync(path.join(role.directory, "preview-process.json")),
				false,
			);
			return {
				role,
				events: native,
				log: fs.readFileSync(
					path.join(role.directory, "transport.log"),
					"utf8",
				),
			};
		});
		save("development-connection-retirement.json", {
			roles: retiredRoles,
			retained,
			reloaded,
			sourceAndDelete: "PASS",
		});
		const lifetime = fs.readFileSync(
			path.join(f.root, ".boat/events.jsonl"),
			"utf8",
		);
		fs.writeFileSync(
			path.join(evidenceDirectory, "native-preview-events.jsonl"),
			lifetime,
			{
				mode: 0o600,
			},
		);
		const native = lifetime
			.trim()
			.split("\n")
			.map(JSON.parse)
			.filter((e) => e.kind === "preview-lifetime");
		assert.ok(
			native.some(
				(e) =>
					e.generation === old.generation &&
					e.stage === "retired" &&
					e.closed === true,
			),
		);
		assert.ok(
			native.some(
				(e) =>
					e.generation === current.generation &&
					e.stage === "predecessor-retired" &&
					e.predecessor.generation === old.generation,
			),
		);
		target = {
			status: "ORIGINAL_DOCUMENT_PRESERVED",
			original,
			neighbor,
			after,
			old,
			current,
			oldCapture: oldCompletion,
			oldDisposal,
			delivered,
			elapsed: mono() - origin,
		};
		save("target-before-cleanup.json", target);
		record("target-assertions-complete", { elapsed: mono() - origin });
	})();
	try {
		await Promise.race([body, liveness]);
	} catch (error) {
		failure = error;
		save("failure-before-cleanup.json", {
			phase,
			stage,
			error: error.stack,
			elapsed: mono() - origin,
			setupFailure: phase === "SETUP",
		});
	} finally {
		clearTimeout(caseTimer);
		phase = "CLEANUP";
		const cleanupOrigin = mono(),
			cleanupDeadline = cleanupOrigin + 40,
			receipts = [];
		const close = async (name, operation) => {
			try {
				await bound(
					Promise.resolve().then(operation),
					Math.min(12, Math.max(0.01, cleanupDeadline - mono())),
					name,
				);
				receipts.push({ name, status: "closed" });
			} catch (error) {
				receipts.push({ name, error: error.message });
				cleanupFailure ??= error;
			}
		};
		await close("browser", async () => {
			if (context) await context.close();
			if (browser) await browser.close();
			if (browserServer) {
				await browserServer.close();
				assert.equal(live(browserServer.process().pid), null);
			}
		});
		for (const [i, h] of handles.entries())
			await close("preview-capture-" + i, async () => {
				const result = await h.stop();
				const d = JSON.parse(
					fs.readFileSync(path.join(h.checkpointDirectory, "disposal.json")),
				);
				assert.ok(d.pipesClosed);
				assert.deepEqual(d.unresolved, []);
				receipts.push({
					name: "preview-disposal-" + i,
					terminal: result.terminal,
					captureComplete: result.captureComplete,
					failure: result.failure,
					disposal: d,
				});
			});
		await close("transport-log-archive", () => {
			if (f) {
				const log = path.join(f.control, "offline-transport.jsonl");
				if (fs.existsSync(log))
					fs.writeFileSync(
						path.join(evidenceDirectory, "controlled-transport-events.jsonl"),
						fs.readFileSync(log),
						{ mode: 0o600 },
					);
				else
					save("transport-log-absence.json", {
						path: log,
						status: "ABSENT_BEFORE_CONTROLLED_TRANSPORT_STARTED",
					});
			}
		});
		await close("vite", async () => {
			if (vite) await vite.close();
		});
		for (const s of servers)
			if (s.listening)
				await close("reservation", () => new Promise((r) => s.close(r)));
		for (const hook of hooks.reverse())
			await close("reused-fixture-cleanup", hook);
		if (canaryIdentity)
			await close("sibling-survival-before-retirement", async () => {
				assert.deepEqual(live(canaryIdentity.pid), canaryIdentity);
				const response = await fetch(`http://127.0.0.1:${canaryPort}/`, {
					signal: AbortSignal.timeout(2000),
				});
				assert.equal(await response.text(), "sibling-alive");
				record("sibling-survived-target-cleanup", { identity: canaryIdentity });
			});
		if (canary)
			await close("sibling-final-retirement", async () => {
				const response = await fetch(`http://127.0.0.1:${canaryPort}/finish`, {
					signal: AbortSignal.timeout(2000),
				});
				assert.equal(await response.text(), "sibling-finished");
				const completed = await bound(
					canary.completion,
					5,
					"Sibling natural terminal/drain",
				);
				const d = JSON.parse(
					fs.readFileSync(
						path.join(evidenceDirectory, "sibling-capture/disposal.json"),
					),
				);
				assert.deepEqual(completed.terminal, { code: 0, signal: null });
				assert.ok(completed.captureComplete);
				assert.ok(d.pipesClosed);
				assert.deepEqual(d.unresolved, []);
				assert.equal(live(canaryIdentity.pid), null);
				receipts.push({
					name: "sibling-natural-capture",
					terminal: completed.terminal,
					captureComplete: completed.captureComplete,
					disposal: d,
				});
			});
		if (mono() > cleanupDeadline)
			cleanupFailure ??= Error("Cleanup exceeded selected40-second reserve");
		save("cleanup.json", {
			receipts,
			elapsed: mono() - cleanupOrigin,
			fixtureRemaining: f ? helpers.fixtureCensus(f.directory) : [],
			errors: receipts.filter((r) => r.error),
		});
	}
	save("result.json", {
		status: failure
			? "CONTROL_OR_SETUP_FAILED"
			: cleanupFailure
				? "CLEANUP_FAILED"
				: target?.status,
		stage,
		failure: failure?.message,
		cleanupFailure: cleanupFailure?.message,
		elapsed: mono() - origin,
		targetFile: target ? "target-before-cleanup.json" : null,
		historicalR38Initiator: "UNKNOWN",
		productionAndPaid: "HOLD",
	});
	if (failure) throw failure;
	if (cleanupFailure) throw cleanupFailure;
}

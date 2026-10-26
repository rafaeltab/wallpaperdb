import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID, createHash } from "node:crypto";
import { createServer, request, Agent } from "node:http";
import { once } from "node:events";
import {
	setTimeout as delay,
	setImmediate as turn,
} from "node:timers/promises";
import {
	openSync,
	closeSync,
	constants,
	fstatSync,
	readSync,
	appendFileSync,
} from "node:fs";
import { join } from "node:path";
import { mutationId, isProcessed } from "./mutation-results.mjs";
import { FixtureCleanupError } from "./mutation-fixture.mjs";

const execute = promisify(execFile);
const imagePin =
	"opensearchproject/opensearch:2.11.0@sha256:925060a17ef0374f2b3d94d0f8fb35dffb491701cd4a72fb12a9ca2fed9929d4";
const configPin =
	"sha256:ce2416eabaf8969b7d9b59dc83db13efbd465144bb95a57d8f60e94ea40d8801";
const source = "src/adapters/opensearch/profiles.ts";
const hash = (value) =>
	createHash("sha256").update(JSON.stringify(value)).digest("hex");
const canonical = (value) =>
	Array.isArray(value)
		? value.map(canonical)
		: value && typeof value === "object"
			? Object.fromEntries(
					Object.keys(value)
						.sort()
						.map((key) => [key, canonical(value[key])]),
				)
			: value;

// Fixed Profile discovery owner, not a repository-wide fixture abstraction.
export async function opensearchFixture(
	cwd,
	image,
	deadline,
	cleanupMs,
	signal,
	cancelAfterNativeProgress,
	clientTimings,
) {
	if (image !== imagePin)
		throw new Error("Owned OpenSearch requires the selected immutable image");
	const name = `wallpaperdb-mutation-opensearch-${randomUUID()}`;
	const token = randomUUID();
	const failureSignal = new AbortController();
	const lifetime = new AbortController();
	const operation = signal
		? AbortSignal.any([signal, lifetime.signal])
		: lifetime.signal;
	const ids = new Set(),
		verifiedOwners = new Set(),
		commands = new Set(),
		sockets = new Set();
	const agent = new Agent({ keepAlive: true, maxSockets: 1 });
	const boundaries = [];
	const finalization = { closeStart: null, finalAudit: null, closeEnd: null };
	const timings = {
		startupSeconds: 0,
		resets: 0,
		resetSeconds: 0,
		initializationSeconds: 0,
		teardownSeconds: 0,
	};
	let failure, observationError, container, port, baseline, server;
	let phase = "startup",
		currentOperation = "initialize-owner",
		boundariesDropped = 0;
	let lastReadinessObservation;
	const ownerStarted = performance.now();
	let closing = false,
		sealed = false,
		busy = false,
		activeOperation,
		closePromise;
	let operationDeadline = deadline,
		cleanupDeadline,
		finalAuditDeadline,
		execution = 0,
		disposed = true;
	let runnerWindow,
		auditWindow,
		auditEnd = 0,
		currentCall,
		activeCall;
	const calls = new Map();
	const runnerTimings = join(clientTimings, "..", "runner-timings.jsonl");
	const historyFile = join(clientTimings, "..", "opensearch-boundaries.jsonl");
	const safeFailure = (
		message = "Owned OpenSearch infrastructure operation failed",
	) => {
		failure ??= new Error(message);
		failureSignal.abort();
		return failure;
	};
	const record = (event, details = {}) => {
		const row = {
			event,
			at: Date.now(),
			phase,
			execution,
			owner: name,
			...details,
		};
		boundaries.push(row);
		if (boundaries.length > 128) {
			boundaries.shift();
			boundariesDropped++;
		}
		try {
			appendFileSync(historyFile, JSON.stringify(row) + "\n", { mode: 0o600 });
		} catch {
			observationError ??= new Error("Owned OpenSearch recorder I/O failed");
			row.observationFailed = true;
			failure ??= observationError;
			failureSignal.abort();
		}
		return row;
	};
	const categoryError = (message, category, httpStatus) => {
		const error = new Error(message);
		error.category = category;
		if (httpStatus !== undefined) error.httpStatus = httpStatus;
		return error;
	};
	const diagnostic = (error, operation, started) => ({
		operation,
		elapsedMilliseconds: Math.max(0, performance.now() - started),
		ownerElapsedMilliseconds: Math.max(0, performance.now() - ownerStarted),
		deadlineRemainingMilliseconds:
			(closing ? finalAuditDeadline : operationDeadline) - performance.now(),
		category: [
			"http-rejected",
			"invalid-json",
			"response-limit",
			"network-refused",
			"network-reset",
			"network-timeout",
			"request-aborted",
			"docker-failed",
			"runtime-version",
			"health-not-ready",
			"deadline-expired",
		].includes(error?.category)
			? error.category
			: "UNKNOWN",
		...(Number.isSafeInteger(error?.httpStatus) &&
		error.httpStatus >= 100 &&
		error.httpStatus <= 599
			? { httpStatus: error.httpStatus }
			: {}),
		signals: {
			externalAborted: signal?.aborted === true,
			ownerFailure: failureSignal.signal.aborted,
			lifetimeAborted: lifetime.signal.aborted,
		},
	});
	const remaining = (
		until = closing ? finalAuditDeadline : operationDeadline,
	) => {
		if (!closing) operation.throwIfAborted();
		if (!closing) failureSignal.signal.throwIfAborted();
		const ms = Math.floor(until - performance.now());
		if (ms <= 0)
			throw categoryError(
				"Owned OpenSearch operation deadline expired",
				"deadline-expired",
			);
		return ms;
	};
	const withinOperation = async (ms, action) => {
		const parent = operationDeadline;
		operationDeadline = Math.min(parent, performance.now() + ms);
		try {
			return await action();
		} finally {
			operationDeadline = parent;
		}
	};
	const docker = async (...args) => {
		currentOperation = "docker-" + args[0];
		const started = performance.now();
		const task = execute("docker", args, {
			cwd,
			encoding: "utf8",
			maxBuffer: 1024 * 1024,
			timeout: Math.min(args[0] === "pull" ? Infinity : 10000, remaining()),
			signal: closing ? undefined : operation,
			killSignal: "SIGKILL",
		});
		const closed = new Promise((resolve) => task.child.once("close", resolve));
		commands.add(closed);
		try {
			return (await task).stdout.trim();
		} catch (error) {
			const missing = /No such (container|object|image)/.test(
				error.stderr ?? "",
			);
			const sanitized = categoryError(
				`Owned OpenSearch Docker ${args[0]} failed`,
				"docker-failed",
			);
			sanitized.missing = missing;
			sanitized.externalAbort =
				error.name === "AbortError" &&
				signal?.aborted === true &&
				operation.reason === signal.reason;
			record("docker-failure", {
				...diagnostic(sanitized, currentOperation, started),
				operation: args[0],
				missing,
				code: typeof error.code === "number" ? error.code : null,
			});
			throw sanitized;
		} finally {
			await closed;
			commands.delete(closed);
		}
	};
	const backend = async (path) => {
		const label =
			path === "/"
				? "read-version"
				: path.startsWith("/_cluster/health")
					? "read-health"
					: path.startsWith("/_tasks")
						? "read-selected-tasks"
						: path.startsWith("/delete/")
							? "delete-owned-index"
							: "read-index-metadata";
		currentOperation = label;
		const started = performance.now();
		const ms = Math.min(1000, remaining());
		const controller = new AbortController();
		const requestSignal = AbortSignal.any([
			controller.signal,
			...(closing ? [] : [operation]),
		]);
		const timeout = setTimeout(() => controller.abort(), ms);
		let req, closed, observedStatus;
		try {
			return await new Promise((resolve, reject) => {
				req = request(
					{
						hostname: "127.0.0.1",
						port,
						path: path.startsWith("/delete/")
							? "/" + path.slice("/delete/".length)
							: path,
						method: path.startsWith("/delete/") ? "DELETE" : "GET",
						agent,
						signal: requestSignal,
					},
					(response) => {
						observedStatus = response.statusCode;
						const chunks = [];
						let length = 0;
						response.on("data", (chunk) => {
							length += chunk.length;
							if (length > 1024 * 1024)
								response.destroy(
									categoryError(
										"Owned OpenSearch response exceeds limit",
										"response-limit",
									),
								);
							else chunks.push(chunk);
						});
						response.on("error", reject);
						response.on("end", () => {
							if (response.statusCode !== 200)
								return reject(
									categoryError(
										"Owned OpenSearch backend response rejected",
										"http-rejected",
										response.statusCode,
									),
								);
							try {
								resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
							} catch {
								reject(
									categoryError(
										"Owned OpenSearch backend JSON is invalid",
										"invalid-json",
									),
								);
							}
						});
					},
				);
				req.on("socket", (socket) => sockets.add(socket));
				req.on("error", reject);
				closed = new Promise((resolveClose) => req.once("close", resolveClose));
				req.end();
			});
		} catch (cause) {
			const categories = {
				ECONNREFUSED: "network-refused",
				ECONNRESET: "network-reset",
				ETIMEDOUT: "network-timeout",
			};
			const error = cause?.category
				? cause
				: categoryError(
						"Owned OpenSearch backend observation failed",
						cause?.name === "AbortError"
							? "request-aborted"
							: (categories[cause?.code] ?? "UNKNOWN"),
					);
			if (
				error.httpStatus === undefined &&
				Number.isSafeInteger(observedStatus)
			)
				error.httpStatus = observedStatus;
			error.externalAbort =
				cause?.name === "AbortError" &&
				signal?.aborted === true &&
				requestSignal.reason === signal.reason;
			record("backend-failure", {
				...diagnostic(error, label, started),
				requestDeadlineAborted: controller.signal.aborted,
			});
			throw error;
		} finally {
			clearTimeout(timeout);
			await closed;
		}
	};
	const object = (value) =>
		value !== null && typeof value === "object" && !Array.isArray(value);
	const metadata = async () => {
		const value = await backend(
			"/_all?expand_wildcards=all&allow_no_indices=true",
		);
		if (
			!object(value) ||
			Object.entries(value).some(
				([key, entry]) =>
					!key ||
					!object(entry) ||
					!object(entry.aliases) ||
					!object(entry.mappings) ||
					!object(entry.settings),
			)
		)
			throw new Error("Owned OpenSearch index inventory is incomplete");
		const owned = Object.keys(value).filter((key) =>
			key.startsWith("gateway_"),
		);
		if (
			owned.some(
				(key) => !/^gateway_[0-9a-f-]{36}_(profiles|wallpapers)$/.test(key),
			)
		)
			throw new Error(
				"Owned OpenSearch index inventory escaped the selected operation",
			);
		const other = Object.fromEntries(
			Object.entries(value).filter(([key]) => !owned.includes(key)),
		);
		if (baseline !== undefined && hash(canonical(other)) !== baseline)
			throw new Error("Owned OpenSearch non-pilot index state changed");
		return { value, owned, other };
	};
	const drainTasks = async () => {
		while (true) {
			const response = await backend(
				"/_tasks?actions=indices%3Adata%2F*&detailed=true",
			);
			if (
				!object(response) ||
				!object(response.nodes) ||
				(response.node_failures !== undefined &&
					(!Array.isArray(response.node_failures) ||
						response.node_failures.length)) ||
				(response.task_failures !== undefined &&
					(!Array.isArray(response.task_failures) ||
						response.task_failures.length)) ||
				response.timed_out === true
			)
				throw new Error("Owned OpenSearch task inventory is incomplete");
			let count = 0;
			for (const node of Object.values(response.nodes)) {
				if (!object(node) || !object(node.tasks))
					throw new Error("Owned OpenSearch task node is incomplete");
				for (const task of Object.values(node.tasks)) {
					if (
						!object(task) ||
						typeof task.action !== "string" ||
						!task.action.startsWith("indices:data/")
					)
						throw new Error("Owned OpenSearch task observation differs");
					count++;
				}
			}
			if (!count) {
				record("selected-task-quiescence", { tasks: 0 });
				return;
			}
			await delay(Math.min(25, remaining()));
		}
	};
	const closeAgent = async () => {
		const pending = [];
		let error;
		for (const socket of sockets) {
			if (socket.closed) continue;
			try {
				pending.push(
					once(socket, "close", {
						signal: AbortSignal.timeout(Math.min(1000, remaining())),
					}),
				);
			} catch (cause) {
				error ??= cause;
			}
		}
		// Observation/deadline failure must never skip synchronous destruction.
		try {
			agent.destroy();
		} catch (cause) {
			error ??= cause;
		}
		for (const result of await Promise.allSettled(pending))
			if (result.status === "rejected") error ??= result.reason;
		if (
			[...sockets].some((socket) => !socket.closed || !socket.destroyed) ||
			Object.values(agent.requests).some((entries) => entries?.length)
		)
			error ??= new Error("Owned OpenSearch controller transport remains open");
		if (error) throw error;
	};
	const inspectOwned = async (target = container) => {
		const rows = JSON.parse(await docker("inspect", target));
		const value = rows[0];
		if (
			!Array.isArray(rows) ||
			rows.length !== 1 ||
			value.Id !== target ||
			value.Name !== `/${name}` ||
			value.Config?.Labels?.["wallpaperdb.mutation"] !== name
		)
			throw new Error("Owned OpenSearch container ownership is unverified");
		// Destructive authority is separate from health/configuration observations.
		verifiedOwners.add(target);
		ids.add(target);
		if (
			value.Image !== configPin ||
			value.Config?.User !== "1000" ||
			!Array.isArray(value.Mounts) ||
			value.Mounts.length
		)
			throw new Error("Owned OpenSearch container metadata differs");
		return value;
	};
	// Same finite startup ceiling as the ordinary fixture, never an observed cost.
	// The owning operation/stage deadline can only shorten this allowance.
	const create = (fixedPort) =>
		withinOperation(120000, async () => {
			const started = performance.now();
			container = await docker(
				"create",
				"--pull=never",
				"--platform",
				"linux/amd64",
				"--name",
				name,
				"--label",
				`wallpaperdb.mutation=${name}`,
				"--publish",
				`127.0.0.1:${fixedPort ?? ""}:9200`,
				"--env",
				"discovery.type=single-node",
				"--env",
				"DISABLE_SECURITY_PLUGIN=true",
				"--env",
				"DISABLE_INSTALL_DEMO_CONFIG=true",
				"--env",
				"OPENSEARCH_JAVA_OPTS=-Xms512m -Xmx512m",
				image,
			);
			if (!/^[0-9a-f]{64}$/.test(container))
				throw new Error("Owned OpenSearch create identity is invalid");
			ids.add(container);
			await docker("start", container);
			const state = await inspectOwned();
			const mapping = state.NetworkSettings?.Ports?.["9200/tcp"];
			if (
				!Array.isArray(mapping) ||
				mapping.length !== 1 ||
				mapping[0].HostIp !== "127.0.0.1" ||
				!/^\d+$/.test(mapping[0].HostPort)
			)
				throw new Error("Owned OpenSearch endpoint mapping differs");
			port = Number(mapping[0].HostPort);
			while (true) {
				const attemptStarted = performance.now();
				try {
					const root = await backend("/");
					if (
						root.version?.distribution !== "opensearch" ||
						root.version.number !== "2.11.0"
					)
						throw categoryError(
							"Owned OpenSearch runtime version differs",
							"runtime-version",
						);
					const health = await backend(
						"/_cluster/health?wait_for_status=yellow&timeout=500ms",
					);
					if (
						health.timed_out !== false ||
						!["yellow", "green"].includes(health.status) ||
						health.number_of_nodes !== 1
					)
						throw categoryError(
							"Owned OpenSearch is not ready",
							"health-not-ready",
						);
					break;
				} catch (error) {
					lastReadinessObservation = diagnostic(
						error,
						currentOperation,
						attemptStarted,
					);
					record("readiness-observation", lastReadinessObservation);
					if (error.externalAbort) throw error;
					if (
						![
							"network-refused",
							"network-reset",
							"network-timeout",
							"request-aborted",
							"health-not-ready",
						].includes(error.category) &&
						!(error.category === "http-rejected" && error.httpStatus === 503)
					)
						throw error;
					await delay(Math.min(50, remaining()), undefined, {
						signal: operation,
					});
				}
			}
			const initial = await metadata();
			if (initial.owned.length)
				throw new Error("Owned OpenSearch startup contains pilot indices");
			baseline = hash(canonical(initial.other));
			timings.startupSeconds += (performance.now() - started) / 1000;
			record("backend-started", {
				containerId: container,
				imageConfigId: state.Image,
				baseline,
			});
		});
	// Read fixed owned regular files completely, retaining identity and append boundaries.
	const readRows = (
		file,
		window,
		offset = window?.offset ?? 0,
		create = false,
	) => {
		const fd = openSync(
			file,
			constants.O_RDONLY |
				constants.O_NOFOLLOW |
				constants.O_NONBLOCK |
				(create ? constants.O_CREAT : 0),
			0o600,
		);
		try {
			const before = fstatSync(fd);
			if (
				!before.isFile() ||
				!Number.isSafeInteger(before.size) ||
				before.size < offset ||
				(window && (before.dev !== window.dev || before.ino !== window.ino))
			)
				throw new Error("Owned OpenSearch observation identity changed");
			const size = before.size - offset;
			if (size > 1024 * 1024)
				throw new Error("Owned OpenSearch observation window exceeds limit");
			const bytes = Buffer.alloc(size);
			let read = 0;
			while (read < size) {
				const count = readSync(fd, bytes, read, size - read, offset + read);
				if (!count) break;
				read += count;
			}
			const after = fstatSync(fd);
			if (
				read !== size ||
				after.size !== before.size ||
				after.mtimeMs !== before.mtimeMs ||
				after.ctimeMs !== before.ctimeMs ||
				(size && bytes[size - 1] !== 10)
			)
				throw new Error("Owned OpenSearch observation is incomplete");
			return {
				rows: size
					? bytes.toString("utf8").slice(0, -1).split("\n").map(JSON.parse)
					: [],
				window: { dev: before.dev, ino: before.ino, offset: before.size },
			};
		} finally {
			closeSync(fd);
		}
	};
	const readCalls = () => {
		const read = readRows(runnerTimings, runnerWindow);
		for (const row of read.rows) {
			const match =
				typeof row.id === "string" &&
				/^(\d+):(coverageCollectionSeconds|mutationExecutionSeconds):\d+(?:\.\d+)?$/.exec(
					row.id,
				);
			if (
				!match ||
				row.phase !== match[2] ||
				!Number.isFinite(row.at) ||
				row.at <= 0 ||
				(row.phase === "mutationExecutionSeconds"
					? !/^\d{1,128}$/.test(row.mutation)
					: row.mutation !== undefined)
			)
				throw new Error("Owned OpenSearch native timing identity differs");
			if (row.seconds === undefined) {
				if (activeCall || calls.has(row.id) || row.endedAt !== undefined)
					throw new Error("Owned OpenSearch native starts overlap");
				activeCall = {
					...row,
					pid: Number(match[1]),
					ended: false,
					acknowledged: false,
					execution: null,
				};
				calls.set(row.id, activeCall);
			} else {
				if (
					!activeCall ||
					activeCall.id !== row.id ||
					activeCall.at !== row.at ||
					activeCall.mutation !== row.mutation ||
					!Number.isFinite(row.seconds) ||
					row.seconds < 0 ||
					!Number.isFinite(row.endedAt) ||
					row.endedAt < row.at
				)
					throw new Error("Owned OpenSearch native completion differs");
				activeCall.ended = true;
				activeCall = undefined;
			}
		}
		runnerWindow = read.window;
	};
	const observations = () => {
		const read = readRows(clientTimings, auditWindow, auditWindow.offset);
		if (read.window.offset < auditEnd)
			throw new Error("Owned OpenSearch observation history shrank");
		auditEnd = read.window.offset;
		if (
			read.rows.some(
				(row) =>
					!object(row) ||
					row.execution !== execution ||
					row.pid !== currentCall.pid ||
					!Number.isSafeInteger(row.threadId) ||
					row.threadId < 0,
			) ||
			new Set(read.rows.map((row) => row.threadId)).size > 1
		)
			throw new Error("Owned OpenSearch current observation binding differs");
		return read.rows;
	};
	const verifyAudit = (rows) => {
		const audits = rows.filter((row) => row.event === "disposal-audit");
		if (audits.length !== 1)
			throw new Error(
				"Owned OpenSearch disposal audit is missing or ambiguous",
			);
		const audit = audits[0];
		if (
			audit.complete !== true ||
			audit.passed !== true ||
			audit.scope !== "actual-sdk-application-adapter-agents-and-sockets" ||
			!Array.isArray(audit.clients) ||
			!audit.clients.length ||
			audit.clients.length > 1024 ||
			!Array.isArray(audit.applications) ||
			audit.applications.length !== 1 ||
			audit.applications.some(
				(value) => value.disposed !== true || value.failed !== false,
			) ||
			new Set(audit.clients.map((value) => value.id)).size !==
				audit.clients.length ||
			audit.clients.some(
				(value) =>
					value.attempted !== true ||
					value.returned !== true ||
					value.failed !== false ||
					!Array.isArray(value.sockets) ||
					value.sockets.some(
						(socket) => socket.closed !== true || socket.destroyed !== true,
					) ||
					!Array.isArray(value.agents) ||
					!value.agents.length ||
					value.agents.some(
						(agent) =>
							agent.queued !== 0 ||
							!Array.isArray(agent.sockets) ||
							agent.sockets.some(
								(socket) => socket.closed !== true || socket.destroyed !== true,
							),
					),
			)
		)
			throw new Error("Owned OpenSearch disposal audit failed");
		return audit;
	};
	const reset = async () => {
		if (!disposed)
			throw new Error("Owned OpenSearch previous disposal has no ACK");
		readCalls();
		if (
			!activeCall ||
			activeCall.execution !== null ||
			activeCall.phase !==
				(execution === 0
					? "coverageCollectionSeconds"
					: "mutationExecutionSeconds")
		)
			throw new Error("Owned OpenSearch native execution binding is missing");
		const before = await withinOperation(5000, async () => {
			await drainTasks();
			return metadata();
		});
		record("before-reset", { indices: before.owned });
		if ((process.env.MUTATION_OPENSEARCH_ISOLATED ?? "1") === "1") {
			await docker("rm", "--force", "--volumes", container);
			container = undefined;
			baseline = undefined;
			await create(String(port));
		} else {
			await withinOperation(5000, async () => {
				for (const index of before.owned) {
					const deleted = await backend("/delete/" + encodeURIComponent(index));
					if (deleted.acknowledged !== true)
						throw new Error(
							"Owned OpenSearch index deletion is unacknowledged",
						);
				}
			});
		}
		const after = await withinOperation(5000, metadata);
		if (after.owned.length)
			throw new Error("Owned OpenSearch reset left pilot state");
		await cancelAfterNativeProgress?.(operationDeadline);
		remaining();
		const read = readRows(clientTimings, auditWindow, auditEnd, true);
		if (read.rows.length)
			throw new Error(
				"Owned OpenSearch unexpected observation between executions",
			);
		auditWindow = read.window;
		auditEnd = read.window.offset;
		currentCall = activeCall;
		currentCall.execution = ++execution;
		disposed = false;
		record("execution-binding", {
			call: currentCall.id,
			phase: currentCall.phase,
			nativeMutation: currentCall.mutation,
			workerPid: currentCall.pid,
			auditWindow,
		});
	};
	const assertHealthy = (context) => {
		context?.assertHealthy?.();
		if (
			failure ||
			observationError ||
			operation.aborted ||
			failureSignal.signal.aborted
		)
			throw new Error(
				"Owned OpenSearch finalization has failure or cancellation evidence",
			);
	};
	const pending = (context) => {
		assertHealthy(context);
		const shutdown = context?.result?.shutdown;
		const receipts = shutdown?.receipts;
		if (
			context?.result?.outcome !== "budget-exhausted" ||
			shutdown?.confirmed !== true ||
			shutdown.failure ||
			shutdown.platform !== "linux" ||
			shutdown.pid !== shutdown.pgid ||
			shutdown.pid !== shutdown.sid ||
			!Number.isSafeInteger(shutdown.pid) ||
			shutdown.pid < 1 ||
			!/^\d+$/.test(shutdown.startTicks) ||
			!Array.isArray(receipts) ||
			!receipts.some((row) => row.event === "anchor-owned") ||
			!receipts.some(
				(row) => row.event === "leader-start" && row.pid === shutdown.leaderPid,
			) ||
			!receipts.some(
				(row) =>
					row.event === "leader-interrupt-requested" &&
					row.reason === "budget-exhausted",
			) ||
			!receipts.some((row) => row.event === "group-quiescent") ||
			receipts.some((row) => row.event === "failure")
		)
			throw new Error("Owned OpenSearch normal-budget group proof is missing");
		readCalls();
		if (
			!currentCall ||
			currentCall !== activeCall ||
			currentCall.ended ||
			currentCall.acknowledged ||
			currentCall.phase !== "mutationExecutionSeconds" ||
			currentCall.execution !== execution ||
			execution < 2 ||
			[...calls.values()].some(
				(call) => call !== currentCall && (!call.ended || !call.acknowledged),
			)
		)
			throw new Error("Owned OpenSearch unfinished native call is ambiguous");
		const rows = observations();
		// A COMPLETE audit without controller ACK is strict failure, even without a terminal native result.
		if (
			!rows.length ||
			rows.some(
				(row) =>
					row.event === "disposal-audit" ||
					row.event === "disposal-acknowledged",
			) ||
			rows.some((row) => row.failed === true || row.passed === false) ||
			rows[0].event !== "execution-ready"
		)
			throw new Error(
				"Owned OpenSearch interrupted execution has disposal or failure evidence",
			);
		const reports = context.reports();
		const index = (report) => {
			if (
				!object(report?.files) ||
				!object(report.files[source]) ||
				typeof report.files[source].source !== "string" ||
				!Array.isArray(report.files[source].mutants)
			)
				throw new Error("Owned OpenSearch native report is incomplete");
			const file = report.files[source];
			const result = new Map(),
				native = new Map();
			for (const mutant of file.mutants) {
				const id = mutationId(source, file.source, mutant);
				if (
					result.has(id) ||
					native.has(mutant.id) ||
					mutant.status === "RuntimeError" ||
					mutant.conflictingStatuses
				)
					throw new Error("Owned OpenSearch native result is ambiguous");
				result.set(id, mutant);
				native.set(mutant.id, id);
			}
			return { result, native, source: file.source };
		};
		const planned = index(reports.planned);
		const partial = reports.partial ? index(reports.partial) : undefined;
		const initial = reports.initial ? index(reports.initial) : undefined;
		if (
			[partial, initial].some(
				(value) => value && value.source !== planned.source,
			)
		)
			throw new Error("Owned OpenSearch native source differs");
		const id = planned.native.get(currentCall.mutation);
		if (
			!id ||
			planned.result.get(id).status !== "Pending" ||
			[partial, initial].some(
				(value) =>
					value?.result.has(id) && value.result.get(id).status !== "Pending",
			)
		)
			throw new Error(
				"Owned OpenSearch current mutation is not unaccepted Pending work",
			);
		for (const call of calls.values()) {
			if (call === currentCall || call.phase === "coverageCollectionSeconds")
				continue;
			const value = partial?.result.get(planned.native.get(call.mutation));
			if (!value || !isProcessed(value) || value.status === "Timeout")
				throw new Error(
					"Owned OpenSearch prior acknowledged terminal is missing",
				);
		}
		return {
			disposition: "interrupted-pending",
			mutation: id,
			nativeMutation: currentCall.mutation,
			accepted: false,
			cooperativeDisposalObserved: false,
			groupShutdownConfirmed: true,
			acknowledgedExecutions: execution - 1,
		};
	};
	const close = (context) => {
		closePromise ??= (async () => {
			const startupCleanup = context?.startup === true;
			sealed = true;
			closing = true;
			phase = "cleanup";
			const started = performance.now();
			cleanupDeadline = started + cleanupMs;
			finalAuditDeadline = cleanupDeadline - Math.min(1000, cleanupMs / 3);
			let error, interrupted;
			finalization.closeStart = record("close-start", {
				disposed,
				startupCleanup,
			});
			try {
				await activeOperation;
				if (!startupCleanup) {
					assertHealthy(context);
					// An ACK from the preceding execution does not describe a later call
					// that started before its reset reached this controller.
					readCalls();
					if (disposed) {
						if (
							!execution ||
							activeCall ||
							[...calls.values()].some(
								(call) =>
									!call.ended || !call.acknowledged || call.execution === null,
							)
						)
							throw new Error(
								"Owned OpenSearch final native calls are not fully acknowledged",
							);
					} else interrupted = pending(context);
				}
				if (!startupCleanup && baseline !== undefined) {
					await drainTasks();
					const state = await metadata();
					record("final-backend-state", { indices: state.owned });
				}
				if (!startupCleanup) assertHealthy(context);
				await turn();
				if (!startupCleanup) assertHealthy(context);
				finalization.finalAudit = record("final-audit", {
					status: startupCleanup ? "SKIPPED_NO_APPLICATION" : "PASSED",
					disposed,
					scope: startupCleanup
						? "startup-no-application"
						: interrupted
							? "owned-backend-and-stopped-pending-owner"
							: "owned-backend-and-acknowledged-sdk-disposal",
					...(interrupted ? { interrupted } : {}),
				});
			} catch (cause) {
				error = cause;
				finalization.finalAudit = record("final-audit", {
					status: "FAILED",
					...diagnostic(cause, currentOperation, started),
				});
			} finally {
				// Preserve accumulated failure while attempting every owned cleanup step.
				finalAuditDeadline = cleanupDeadline;
				try {
					server?.closeAllConnections();
				} catch (cause) {
					error ??= cause;
					record(
						"cleanup-failure",
						diagnostic(cause, "close-control-connections", started),
					);
				}
				if (server?.listening) {
					try {
						await new Promise((resolve, reject) =>
							server.close((cause) => (cause ? reject(cause) : resolve())),
						);
					} catch (cause) {
						error ??= cause;
						record(
							"cleanup-failure",
							diagnostic(cause, "close-control-server", started),
						);
					}
				}
				try {
					await closeAgent();
				} catch (cause) {
					error ??= cause;
					record(
						"cleanup-failure",
						diagnostic(cause, "close-controller-agent", started),
					);
				}
				await Promise.all([...commands]);
				const removalCandidates = new Set();
				if (typeof container === "string" && /^[a-f0-9]{64}$/.test(container))
					removalCandidates.add(container);
				try {
					const listed = await docker(
						"ps",
						"-aq",
						"--no-trunc",
						"--filter",
						`label=wallpaperdb.mutation=${name}`,
					);
					const candidates = listed ? listed.split("\n") : [];
					if (
						candidates.some((id) => !/^[a-f0-9]{64}$/.test(id)) ||
						new Set(candidates).size !== candidates.length
					) {
						const invalid = new Error(
							"Owned OpenSearch reconciliation inventory is incomplete",
						);
						error ??= invalid;
						record(
							"cleanup-failure",
							diagnostic(invalid, "reconcile-owned-container", started),
						);
					} else for (const id of candidates) removalCandidates.add(id);
				} catch (cause) {
					error ??= cause;
					record(
						"cleanup-failure",
						diagnostic(cause, "reconcile-owned-container", started),
					);
				}
				for (const target of removalCandidates) {
					let healthy = false;
					try {
						await inspectOwned(target);
						healthy = true;
					} catch (cause) {
						if (cause.missing) continue;
						error ??= cause;
						record(
							"cleanup-failure",
							diagnostic(cause, "inspect-owned-container", started),
						);
					}
					if (!verifiedOwners.has(target)) {
						record("owner-reconciliation", { verified: false, removed: false });
						continue;
					}
					record("owner-reconciliation", {
						containerId: target,
						verified: true,
						healthy,
					});
					try {
						await docker("rm", "--force", "--volumes", target);
						record("owned-container-removed", { containerId: target });
					} catch (cause) {
						if (!cause.missing) error ??= cause;
						record(
							"cleanup-failure",
							diagnostic(cause, "remove-owned-container", started),
						);
					}
				}
				try {
					const present = await docker(
						"ps",
						"-aq",
						"--no-trunc",
						"--filter",
						`label=wallpaperdb.mutation=${name}`,
					);
					if (present)
						error ??= new Error("Owned OpenSearch container remains present");
					else
						record("owned-resources-absent", {
							containers: 0,
							scope: "exact-owner-label",
							cooperativeDisposalObserved:
								!startupCleanup && !interrupted && disposed,
						});
				} catch (cause) {
					error ??= cause;
					record(
						"cleanup-failure",
						diagnostic(cause, "verify-owned-container-absence", started),
					);
				}
				lifetime.abort();
				timings.teardownSeconds = (performance.now() - started) / 1000;
				finalization.closeEnd = record("close-end", {
					failed: Boolean(error),
					...(error
						? {
								diagnostic: error.message?.startsWith("Owned OpenSearch")
									? error.message
									: "Owned OpenSearch cleanup failed",
							}
						: {}),
				});
			}
			// A request/failure/cancel delivered during a drain cannot be erased by successful removal.
			await turn();
			try {
				if (!startupCleanup) context?.assertHealthy?.();
				if (
					failure ||
					observationError ||
					(!startupCleanup && signal?.aborted) ||
					failureSignal.signal.aborted
				)
					throw new Error("Owned OpenSearch late failure or cancellation");
			} catch (cause) {
				error ??= cause;
			}
			if (error)
				throw new Error("Owned OpenSearch finalization failed", {
					cause: error,
				});
		})();
		return closePromise;
	};
	try {
		try {
			await docker("image", "inspect", image);
		} catch (error) {
			if (!error.missing) throw error;
			await docker("pull", "--platform", "linux/amd64", image);
		}
		await create();
		server = createServer((incoming, outgoing) => {
			if (
				incoming.method !== "POST" ||
				incoming.headers.authorization !== `Bearer ${token}` ||
				!["/reset", "/failure", `/disposed/${execution}`].includes(incoming.url)
			) {
				outgoing.writeHead(404).end();
				return;
			}
			if (incoming.url === "/failure" || sealed || busy || failure) {
				safeFailure("Owned OpenSearch worker disposal or control failed");
				outgoing.writeHead(503).end();
				return;
			}
			busy = true;
			activeOperation = (async () => {
				const started = performance.now();
				const recreating =
					incoming.url === "/reset" &&
					(process.env.MUTATION_OPENSEARCH_ISOLATED ?? "1") === "1";
				operationDeadline = Math.min(
					deadline,
					started + (recreating ? 120000 : 5000),
				);
				const timer = setTimeout(
					() => safeFailure("Owned OpenSearch reset/disposal deadline expired"),
					remaining(),
				);
				try {
					if (incoming.url === "/reset") {
						if (
							process.env.MUTATION_OPENSEARCH_RESET_FAILURE ===
								"after-progress" &&
							execution >= 2
						)
							throw new Error("Requested OpenSearch reset failure");
						await reset();
						assertHealthy();
						timings.resets++;
						timings.resetSeconds += (performance.now() - started) / 1000;
						outgoing.writeHead(200).end(String(execution));
					} else {
						if (disposed)
							throw new Error("Owned OpenSearch duplicate disposal ACK");
						const rows = observations();
						verifyAudit(rows);
						const initialization = rows.filter(
							(row) => row.event === "application-acquired",
						);
						if (
							initialization.length !== 1 ||
							!Number.isFinite(initialization[0].seconds) ||
							initialization[0].seconds < 0
						)
							throw new Error(
								"Owned OpenSearch initialization observation is incomplete",
							);
						timings.initializationSeconds += initialization[0].seconds;
						assertHealthy();
						currentCall.acknowledged = true;
						disposed = true;
						record("strict-disposal-ack", { call: currentCall.id });
						assertHealthy();
						outgoing.writeHead(200).end();
					}
				} catch (error) {
					record(
						"operation-failure",
						diagnostic(
							error,
							incoming.url === "/reset" ? "reset" : "disposal",
							started,
						),
					);
					safeFailure("Owned OpenSearch reset/disposal failed");
					outgoing.writeHead(503).end();
				} finally {
					clearTimeout(timer);
					busy = false;
					operationDeadline = deadline;
				}
			})().catch((error) => {
				record(
					"operation-rejection",
					diagnostic(error, "control-request", ownerStarted),
				);
				safeFailure("Owned OpenSearch controller request failed");
				outgoing.destroy();
			});
		});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		phase = "execution";
		return {
			name,
			image,
			operationDeadline: deadline,
			cleanupMs,
			timings,
			close,
			get failure() {
				return failure;
			},
			failureSignal: failureSignal.signal,
			get containerIds() {
				return [...ids];
			},
			get boundaries() {
				return structuredClone(boundaries);
			},
			get boundariesDropped() {
				return boundariesDropped;
			},
			get history() {
				return {
					file: "opensearch-boundaries.jsonl",
					complete: !observationError,
				};
			},
			get finalization() {
				return structuredClone(finalization);
			},
			env: {
				WALLPAPERDB_MUTATION_OPENSEARCH_URL: `http://127.0.0.1:${port}`,
				WALLPAPERDB_MUTATION_OPENSEARCH_RESET: `http://127.0.0.1:${server.address().port}/reset`,
				WALLPAPERDB_MUTATION_OPENSEARCH_TOKEN: token,
			},
		};
	} catch (cause) {
		const interruptionSafe =
			(signal?.aborted === true &&
				operation.reason === signal.reason &&
				(cause === signal.reason ||
					cause.externalAbort === true ||
					(cause?.name === "AbortError" &&
						cause.cause === operation.reason))) ||
			(cause.category === "deadline-expired" && performance.now() >= deadline);
		record("startup-failure", {
			...diagnostic(cause, currentOperation, ownerStarted),
			interruptionSafe,
			...(lastReadinessObservation ? { lastReadinessObservation } : {}),
		});
		const startup = new Error("Owned OpenSearch startup failed", { cause });
		startup.interruptionSafe = interruptionSafe;
		try {
			await close({ startup: true });
		} catch (cleanup) {
			throw new FixtureCleanupError(startup, cleanup);
		}
		throw startup;
	}
}

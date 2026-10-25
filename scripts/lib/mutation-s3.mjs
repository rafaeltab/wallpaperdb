import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
	appendFileSync,
	closeSync,
	constants,
	fstatSync,
	mkdtempSync,
	openSync,
	readSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { Agent, createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { FixtureCleanupError } from "./mutation-fixture.mjs";

const execute = promisify(execFile);

/** One serial Asset reader owner. No Compose resources or shared reaper. */
export async function s3Fixture(
	cwd,
	image,
	deadline,
	cleanupMs,
	signal,
	cancelAfterNativeProgress,
	clientTimings,
) {
	if (!/^chrislusf\/seaweedfs:4\.47@sha256:[a-f0-9]{64}$/.test(image))
		throw new Error("Mutation S3 requires the immutable SeaweedFS 4.47 image");
	const sdk = createRequire(join(cwd, "package.json"))("@aws-sdk/client-s3");
	const name = `wallpaperdb-mutation-${randomUUID()}`;
	const token = randomUUID();
	const credentials = () => ({
		accessKeyId: randomUUID(),
		secretAccessKey: randomUUID(),
	});
	const admin = credentials(),
		app = credentials(),
		helper = credentials();
	const directory = mkdtempSync(join(tmpdir(), "wallpaperdb-mutation-s3-"));
	const configFile = join(directory, "s3.json");
	writeFileSync(
		configFile,
		JSON.stringify({
			identities: [
				{
					name: "controller",
					credentials: [
						{ accessKey: admin.accessKeyId, secretKey: admin.secretAccessKey },
					],
					actions: ["Admin", "Read", "Write", "List", "Tagging"],
				},
				{
					name: "reader",
					credentials: [
						{ accessKey: app.accessKeyId, secretKey: app.secretAccessKey },
					],
					actions: ["Read:assets"],
				},
				{
					name: "seed",
					credentials: [
						{
							accessKey: helper.accessKeyId,
							secretKey: helper.secretAccessKey,
						},
					],
					actions: ["Write:assets"],
				},
			],
		}),
		{ mode: 0o600 },
	);
	const lifetime = new AbortController();
	const operation = signal
		? AbortSignal.any([signal, lifetime.signal])
		: lifetime.signal;
	const abort = new AbortController();
	const commands = new Set(),
		ids = new Set();
	const boundaries = [];
	const finalization = { closeStart: null, finalAudit: null, closeEnd: null };
	const timings = {
		startupSeconds: 0,
		resets: 0,
		resetSeconds: 0,
		initializationSeconds: 0,
		teardownSeconds: 0,
	};
	let client,
		port,
		server,
		failure,
		resetDone,
		resetAbort,
		closePromise,
		cleanupDeadline;
	let closing = false,
		resetting = false,
		execution = 0,
		disposed = true;
	let observationError;
	let auditDeadline;
	let boundariesDropped = 0;
	const record = (event, details = {}) => {
		if (boundaries.length === 128) {
			boundaries.shift();
			boundariesDropped++;
		}
		const value = { event, at: Date.now(), ...details };
		boundaries.push(value);
		appendFileSync(
			clientTimings,
			`${JSON.stringify({ ...value, scope: "s3-controller", pid: process.pid })}\n`,
		);
		return value;
	};
	const recordFinal = (slot, event, details) => {
		try {
			finalization[slot] = record(event, details);
		} catch (error) {
			observationError ??= error;
		}
	};
	const operationSignal = () =>
		resetAbort ? AbortSignal.any([operation, resetAbort.signal]) : operation;
	const remaining = () => {
		operationSignal().throwIfAborted();
		const ms = Math.floor((auditDeadline ?? deadline) - performance.now());
		if (ms <= 0) throw new Error("Mutation S3 operation deadline expired");
		return ms;
	};
	const docker = async (...args) => {
		if (closing && !["rm", "ps"].includes(args[0]))
			throw new Error("Owned S3 fixture is closing");
		const request = execute("docker", args, {
			encoding: "utf8",
			maxBuffer: 1024 * 1024,
			timeout: closing
				? Math.max(1, Math.floor(cleanupDeadline - performance.now()))
				: Math.min(args[0] === "pull" ? Infinity : 10000, remaining()),
			signal: closing ? undefined : operationSignal(),
			killSignal: "SIGKILL",
		});
		const closed = new Promise((resolve) =>
			request.child.once("close", resolve),
		);
		commands.add(closed);
		try {
			return (await request).stdout.trim();
		} catch (cause) {
			const error = new Error("Owned S3 Docker operation failed", { cause });
			error.missingImage = cause.stderr?.includes("No such image") === true;
			error.missingContainer =
				cause.stderr?.includes("No such container") === true;
			throw error;
		} finally {
			await closed;
			commands.delete(closed);
		}
	};
	const send = async (command) => {
		let response;
		try {
			response = await client.send(command, {
				abortSignal: AbortSignal.any([
					operationSignal(),
					AbortSignal.timeout(Math.min(1000, remaining())),
				]),
			});
		} catch (cause) {
			const status = cause.$metadata?.httpStatusCode;
			throw new Error(
				`Owned S3 storage operation failed${Number.isSafeInteger(status) && status >= 100 && status <= 599 ? ` with HTTP ${status}` : ""}`,
				{ cause },
			);
		}
		if (
			response.$metadata.httpStatusCode !== 200 &&
			response.$metadata.httpStatusCode !== 204
		)
			throw new Error("Owned S3 operation returned an unexpected status");
		return response;
	};
	const bucketState = async () => {
		const listed = await send(new sdk.ListBucketsCommand({}));
		if (
			!Array.isArray(listed.Buckets) ||
			listed.Buckets.length !== 1 ||
			listed.Buckets[0].Name !== "assets" ||
			listed.ContinuationToken
		)
			throw new Error("Owned S3 bucket inventory is incomplete or changed");
		const Bucket = "assets";
		const versioning = await send(
			new sdk.GetBucketVersioningCommand({ Bucket }),
		);
		const versions = await send(
			new sdk.ListObjectVersionsCommand({ Bucket, MaxKeys: 1000 }),
		);
		const objects = await send(
			new sdk.ListObjectsV2Command({ Bucket, MaxKeys: 1000 }),
		);
		const multipart = await send(
			new sdk.ListMultipartUploadsCommand({ Bucket, MaxUploads: 1000 }),
		);
		if (
			versions.IsTruncated !== false ||
			objects.IsTruncated !== false ||
			multipart.IsTruncated !== false
		)
			throw new Error("Owned S3 state listing is incomplete");
		const state = {
			bucket: Bucket,
			versioning: versioning.Status ?? "disabled",
			objects: objects.Contents ?? [],
			versions: versions.Versions ?? [],
			deleteMarkers: versions.DeleteMarkers ?? [],
			uploads: multipart.Uploads ?? [],
		};
		for (const field of ["objects", "versions", "deleteMarkers", "uploads"])
			if (
				!Array.isArray(state[field]) ||
				state[field].length > 1000 ||
				state[field].some(
					(entry) => typeof entry.Key !== "string" || !entry.Key,
				)
			)
				throw new Error("Malformed owned S3 state inventory");
		if (
			[...state.versions, ...state.deleteMarkers].some(
				(entry) => typeof entry.VersionId !== "string" || !entry.VersionId,
			) ||
			state.uploads.some(
				(entry) => typeof entry.UploadId !== "string" || !entry.UploadId,
			)
		)
			throw new Error("Missing owned S3 version or multipart identity");
		return state;
	};
	const summarizeState = (state) => ({
		bucket: state.bucket,
		versioning: state.versioning,
		objects: state.objects.map(({ Key, Size }) => ({ key: Key, size: Size })),
		versions: state.versions.map(({ Key, VersionId }) => ({
			key: Key,
			version: VersionId,
		})),
		deleteMarkers: state.deleteMarkers.map(({ Key, VersionId }) => ({
			key: Key,
			version: VersionId,
		})),
		uploads: state.uploads.map(({ Key, UploadId }) => ({
			key: Key,
			upload: UploadId,
		})),
	});
	const stopClient = async () => {
		if (!client) return;
		const sockets = new Set();
		let error;
		try {
			if (typeof client.config.requestHandler.httpHandlerConfigs !== "function")
				throw new Error("Owned S3 controller transport is unobservable");
			const config = client.config.requestHandler.httpHandlerConfigs();
			for (const key of ["httpAgent", "httpsAgent"]) {
				const agent = config[key];
				if (agent === undefined) continue;
				if (!(agent instanceof Agent))
					throw new Error("Owned S3 controller agent is unobservable");
				if (Object.values(agent.requests).some((requests) => requests?.length))
					throw new Error("Owned S3 controller has queued requests");
				for (const socket of [
					...Object.values(agent.sockets),
					...Object.values(agent.freeSockets),
				].flatMap((entries) => entries ?? []))
					sockets.add(socket);
			}
		} catch (cause) {
			error = cause;
		}
		const timeout = Math.max(
			1,
			Math.min(
				1000,
				Math.floor((closing ? cleanupDeadline : deadline) - performance.now()),
			),
		);
		const signal = AbortSignal.timeout(timeout);
		const closed = [...sockets].map((socket) =>
			socket.closed
				? Promise.resolve()
				: once(socket, "close", { signal }).then(
						() => undefined,
						(cause) => cause,
					),
		);
		const identities = [...sockets].map((socket) => ({
			localAddress: socket.localAddress,
			localPort: socket.localPort,
			remoteAddress: socket.remoteAddress,
			remotePort: socket.remotePort,
		}));
		try {
			client.destroy();
		} catch (cause) {
			error ??= cause;
		}
		for (const result of await Promise.all(closed))
			if (result !== undefined) error ??= result;
		if ([...sockets].some((socket) => !socket.destroyed || !socket.closed))
			error ??= new Error("Owned S3 controller socket remains open");
		record("controller-disposal", {
			complete: !error,
			sockets: [...sockets].map((socket, index) => ({
				...identities[index],
				destroyed: socket.destroyed,
				closed: socket.closed,
			})),
		});
		if (error) throw error;
	};
	const create = async (fixedPort = "") => {
		const started = performance.now();
		await docker(
			"create",
			"--pull=never",
			"--name",
			name,
			"--label",
			`wallpaperdb.mutation=${name}`,
			"--publish",
			`127.0.0.1:${fixedPort}:9000`,
			image,
			"mini",
			"-dir=/data",
			"-ip=127.0.0.1",
			"-ip.bind=0.0.0.0",
			"-s3.port=9000",
			"-s3.config=/tmp/mutation-s3.json",
			"-s3.autoCreateBucket=false",
			"-s3.allowDeleteBucketNotEmpty=false",
			"-s3.port.iceberg=0",
			"-s3.port.lance=0",
			"-admin.ui=false",
			"-webdav=false",
			"-master.telemetry=false",
		);
		await docker("cp", configFile, `${name}:/tmp/mutation-s3.json`);
		await docker("start", name);
		const inspected = JSON.parse(await docker("inspect", name))[0];
		if (
			!/^[a-f0-9]{64}$/.test(inspected.Id) ||
			inspected.Name !== `/${name}` ||
			inspected.Config.Labels["wallpaperdb.mutation"] !== name
		)
			throw new Error("Owned S3 container identity could not be verified");
		ids.add(inspected.Id);
		const mapping = inspected.NetworkSettings.Ports["9000/tcp"];
		if (
			!Array.isArray(mapping) ||
			mapping.length !== 1 ||
			mapping[0].HostIp !== "127.0.0.1" ||
			!/^\d+$/.test(mapping[0].HostPort)
		)
			throw new Error("Owned S3 endpoint mapping is incomplete");
		port = Number(mapping[0].HostPort);
		client = new sdk.S3Client({
			endpoint: `http://127.0.0.1:${port}`,
			region: "us-east-1",
			credentials: admin,
			forcePathStyle: true,
			maxAttempts: 1,
		});
		while (true) {
			remaining();
			try {
				const logs = await docker("logs", "--tail", "80", name);
				if (
					!logs.includes("All enabled components are running and ready to use:")
				)
					throw new Error("S3 startup is not ready");
				break;
			} catch {
				await delay(Math.min(50, remaining()), undefined, {
					signal: operationSignal(),
				});
			}
		}
		await send(new sdk.CreateBucketCommand({ Bucket: "assets" }));
		const state = await bucketState();
		if (
			state.objects.length ||
			state.versions.length ||
			state.deleteMarkers.length ||
			state.uploads.length ||
			state.versioning !== "disabled"
		)
			throw new Error("Owned S3 startup left mutable state");
		timings.startupSeconds += (performance.now() - started) / 1000;
		record("backend-started", { containerId: inspected.Id });
	};
	const verifyDisposal = () => {
		if (!disposed)
			throw new Error("Missing previous S3 disposal acknowledgement");
	};
	const reset = async () => {
		verifyDisposal();
		const state = await bucketState();
		record("before-reset", { execution, ...summarizeState(state) });
		if ((process.env.MUTATION_S3_ISOLATED ?? "1") === "1") {
			await stopClient();
			await docker("rm", "--force", "--volumes", name);
			await create(String(port));
		} else {
			// The selected reader cannot create any of these states. Remove every
			// observed owner resource, including versions and incomplete uploads.
			for (const upload of state.uploads)
				await send(
					new sdk.AbortMultipartUploadCommand({
						Bucket: "assets",
						Key: upload.Key,
						UploadId: upload.UploadId,
					}),
				);
			for (const object of [...state.versions, ...state.deleteMarkers])
				await send(
					new sdk.DeleteObjectCommand({
						Bucket: "assets",
						Key: object.Key,
						VersionId: object.VersionId,
					}),
				);
			const versionedKeys = new Set(
				[...state.versions, ...state.deleteMarkers].map((object) => object.Key),
			);
			for (const object of state.objects.filter(
				(object) => !versionedKeys.has(object.Key),
			))
				await send(
					new sdk.DeleteObjectCommand({ Bucket: "assets", Key: object.Key }),
				);
			await send(new sdk.DeleteBucketCommand({ Bucket: "assets" }));
			const started = performance.now();
			await send(new sdk.CreateBucketCommand({ Bucket: "assets" }));
			timings.initializationSeconds += (performance.now() - started) / 1000;
		}
		const clean = await bucketState();
		if (
			clean.objects.length ||
			clean.versions.length ||
			clean.deleteMarkers.length ||
			clean.uploads.length ||
			clean.versioning !== "disabled"
		)
			throw new Error("Owned S3 reset left mutable state");
		record("after-reset", {
			execution: execution + 1,
			...summarizeState(clean),
		});
	};
	const disposalReceipt = () => {
		const descriptor = openSync(
			clientTimings,
			constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
		);
		let text;
		try {
			if (!fstatSync(descriptor).isFile())
				throw new Error("S3 observation is not a regular file");
			const buffer = Buffer.alloc(1024 * 1024 + 1);
			let size = 0;
			while (size < buffer.length) {
				const count = readSync(descriptor, buffer, size, buffer.length - size);
				if (!count) break;
				size += count;
			}
			if (size === buffer.length)
				throw new Error("S3 observation file exceeds its limit");
			text = buffer.subarray(0, size).toString("utf8");
		} finally {
			closeSync(descriptor);
		}
		const observations = text.split("\n").filter(Boolean).map(JSON.parse);
		const rows = observations.filter(
			(row) => row.execution === execution && row.event === "disposal-audit",
		);
		if (rows.length !== 1)
			throw new Error("Missing or ambiguous S3 client audit");
		const row = rows[0];
		if (
			!Number.isSafeInteger(row.pid) ||
			row.pid <= 0 ||
			!Number.isSafeInteger(row.threadId) ||
			row.threadId < 0 ||
			row.scope !== "actual-sdk-instances-and-node-agents" ||
			row.complete !== true ||
			row.passed !== true ||
			!Array.isArray(row.clients) ||
			row.clients.length < 1 ||
			row.clients.length > 1024 ||
			new Set(row.clients.map((entry) => entry.id)).size !==
				row.clients.length ||
			row.clients.some(
				(entry) =>
					!Number.isSafeInteger(entry.id) ||
					entry.id < 1 ||
					entry.attempted !== true ||
					entry.returned !== true ||
					entry.observationFailed !== false ||
					!Array.isArray(entry.ownedSockets) ||
					entry.ownedSockets.some(
						(socket) => socket.destroyed !== true || socket.closed !== true,
					) ||
					!Array.isArray(entry.agents) ||
					entry.agents.some(
						(agent) =>
							!["httpAgent", "httpsAgent"].includes(agent.name) ||
							agent.queued !== 0 ||
							!Array.isArray(agent.sockets) ||
							agent.sockets.some(
								(socket) => socket.destroyed !== true || socket.closed !== true,
							),
					),
			)
		)
			throw new Error("Incomplete S3 instance/agent disposal audit");
		const applications = observations.filter(
			(entry) =>
				entry.execution === execution &&
				entry.event === "application-observation",
		);
		if (applications.length !== 1)
			throw new Error("Missing or ambiguous S3 application observation");
		const application = applications[0];
		const clientIds = new Set(row.clients.map((entry) => entry.id));
		if (
			application.pid !== row.pid ||
			application.threadId !== row.threadId ||
			application.complete !== true ||
			typeof application.failed !== "boolean" ||
			!clientIds.has(application.helperClientId) ||
			!Array.isArray(application.clientIds) ||
			new Set(application.clientIds).size !== application.clientIds.length ||
			application.clientIds.some(
				(id) => id === application.helperClientId || !clientIds.has(id),
			) ||
			(!application.failed && application.clientIds.length !== 1)
		)
			throw new Error("Incomplete S3 helper/application binding observation");
		return {
			pid: row.pid,
			threadId: row.threadId,
			clientIds: row.clients.map((entry) => entry.id),
			complete: true,
			applicationClientIds: application.clientIds,
			ordinaryTestFailed: application.failed,
		};
	};
	const remove = async () => {
		try {
			await docker("rm", "--force", "--volumes", name);
		} catch (cause) {
			if (!cause.missingContainer) throw cause;
		}
		const remaining = await docker(
			"ps",
			"-aq",
			"--no-trunc",
			"--filter",
			`label=wallpaperdb.mutation=${name}`,
		);
		if (remaining) throw new Error("Owned S3 container remains after teardown");
		return {
			complete: true,
			scope: "exact-owner-container-label",
			containerIds: [],
		};
	};
	const close = () => {
		closePromise ??= (async () => {
			const started = performance.now();
			cleanupDeadline = started + cleanupMs;
			auditDeadline = cleanupDeadline - Math.min(1000, cleanupMs / 3);
			const timer = setTimeout(
				() => lifetime.abort(),
				Math.max(1, auditDeadline - performance.now()),
			);
			let error;
			let resources;
			try {
				recordFinal("closeStart", "close-start", {
					execution,
					disposed,
					resetting,
				});
				await resetDone;
				if (operation.aborted && !disposed)
					failure ??= new Error(
						"Owned S3 interruption left unacknowledged disposal",
					);
				if (!failure && !operation.aborted && client) {
					recordFinal("finalAudit", "final-audit", { status: "STARTED" });
					verifyDisposal();
					const state = await bucketState();
					recordFinal("finalAudit", "final-audit", {
						status: "PASSED",
						execution,
						disposed,
						...summarizeState(state),
						scope: "owned-backend-state-and-acknowledged-sdk-disposal",
					});
				} else
					recordFinal("finalAudit", "final-audit", {
						status: "SKIPPED",
						reason: failure
							? "sticky-fixture-failure"
							: operation.aborted
								? "operation-aborted"
								: "no-controller",
					});
			} catch (cause) {
				error = cause;
				recordFinal("finalAudit", "final-audit", {
					status: "FAILED",
					execution,
					disposed,
				});
			}
			closing = true;
			lifetime.abort();
			try {
				server?.closeAllConnections();
				if (server?.listening)
					await new Promise((resolve) => server.close(resolve));
				await stopClient();
				await Promise.all([...commands]);
				await resetDone;
			} catch (cause) {
				error ??= cause;
			} finally {
				try {
					resources = await remove();
				} catch (cause) {
					error ??= cause;
				} finally {
					clearTimeout(timer);
					try {
						rmSync(directory, { recursive: true, force: true });
					} catch (cause) {
						error ??= cause;
					}
					timings.teardownSeconds = (performance.now() - started) / 1000;
					recordFinal("closeEnd", "close-end", {
						failed: Boolean(error || observationError),
						observationFailed: Boolean(observationError),
						teardownSeconds: timings.teardownSeconds,
						resources: resources ?? {
							complete: false,
							scope: "exact-owner-container-label",
						},
					});
				}
			}
			if (observationError)
				throw new AggregateError(
					error ? [error, observationError] : [observationError],
					"S3 finalization observation failed",
					{ cause: error ?? observationError },
				);
			if (error) throw error;
		})();
		return closePromise;
	};
	try {
		try {
			await docker("image", "inspect", image);
		} catch (error) {
			if (!error.missingImage) throw error;
			await docker("pull", image);
		}
		await create();
		server = createServer((request, response) => {
			if (
				request.method !== "POST" ||
				request.headers.authorization !== `Bearer ${token}` ||
				!(
					request.url === "/reset" ||
					request.url === "/failure" ||
					request.url === `/disposed/${execution}`
				)
			) {
				response.writeHead(404).end();
				return;
			}
			if (request.url === "/failure" || closing || resetting || failure) {
				failure ??= new Error(
					"Owned S3 disposal failed or fixture unavailable",
				);
				abort.abort();
				response.writeHead(503).end();
				return;
			}
			resetting = true;
			resetDone = (async () => {
				const started = performance.now();
				resetAbort = new AbortController();
				const operationDeadline = Math.min(deadline, started + 5000);
				const timer = setTimeout(
					() => {
						failure ??= new Error("Owned S3 reset/disposal deadline expired");
						resetAbort.abort();
						abort.abort();
					},
					Math.max(1, operationDeadline - performance.now()),
				);
				try {
					if (request.url === "/reset") {
						if (
							process.env.MUTATION_S3_RESET_FAILURE === "after-progress" &&
							execution >= 2
						)
							throw new Error("Requested S3 reset-failure diagnostic");
						await reset();
						await cancelAfterNativeProgress?.(operationDeadline);
						remaining();
						execution++;
						disposed = false;
						timings.resets++;
						timings.resetSeconds += (performance.now() - started) / 1000;
						response.writeHead(200).end(String(execution));
					} else {
						const audit = disposalReceipt();
						if (disposed) throw new Error("Duplicate owned S3 disposal");
						disposed = true;
						record("client-audit", { execution, ...audit });
						response.writeHead(200).end();
					}
				} catch (error) {
					// Never expose SDK errors, credentials or command text in receipts.
					failure ??= new Error(
						error.message.startsWith("Owned") ||
							error.message.startsWith("Missing") ||
							error.message.startsWith("Requested") ||
							error.message.startsWith("Incomplete")
							? error.message
							: "Owned S3 infrastructure operation failed",
					);
					response.writeHead(503).end();
					abort.abort();
				} finally {
					clearTimeout(timer);
					record("operation-end", {
						operation: request.url === "/reset" ? "reset" : "disposed",
						execution,
						failed: Boolean(failure),
					});
					resetting = false;
					resetAbort = undefined;
				}
			})();
		});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		return {
			name,
			image,
			operationDeadline: deadline,
			cleanupMs,
			timings,
			close,
			get containerIds() {
				return [...ids];
			},
			get boundaries() {
				return [...boundaries];
			},
			get boundariesDropped() {
				return boundariesDropped;
			},
			get finalization() {
				return structuredClone(finalization);
			},
			get failure() {
				return failure;
			},
			failureSignal: abort.signal,
			env: {
				WALLPAPERDB_MUTATION_S3_ENDPOINT: `http://127.0.0.1:${port}`,
				WALLPAPERDB_MUTATION_S3_RESET: `http://127.0.0.1:${server.address().port}/reset`,
				WALLPAPERDB_MUTATION_S3_TOKEN: token,
				WALLPAPERDB_MUTATION_S3_APP_KEY: app.accessKeyId,
				WALLPAPERDB_MUTATION_S3_APP_SECRET: app.secretAccessKey,
				WALLPAPERDB_MUTATION_S3_HELPER_KEY: helper.accessKeyId,
				WALLPAPERDB_MUTATION_S3_HELPER_SECRET: helper.secretAccessKey,
			},
		};
	} catch (error) {
		try {
			await close();
		} catch (cleanupError) {
			throw new FixtureCleanupError(error, cleanupError);
		}
		throw error;
	}
}

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
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { FixtureCleanupError } from "./mutation-fixture.mjs";
import { isProcessed, mutationId } from "./mutation-results.mjs";

const execute = promisify(execFile);
// The stock entrypoint drops to seaweed; docker cp creates this 0600 file as root.
const privateConfigurationEntrypoint =
	'chown seaweed:seaweed /tmp/mutation-s3.json && exec /entrypoint.sh "$@"';

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
	try {
		writeFileSync(
			configFile,
			JSON.stringify({
				identities: [
					{
						name: "controller",
						credentials: [
							{
								accessKey: admin.accessKeyId,
								secretKey: admin.secretAccessKey,
							},
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
	} catch (cause) {
		const initializationError = new Error(
			"Owned S3 private configuration initialization failed",
			{ cause },
		);
		try {
			rmSync(directory, { recursive: true, force: true });
		} catch (cleanupCause) {
			throw new FixtureCleanupError(
				initializationError,
				new Error("Owned S3 private configuration cleanup failed", {
					cause: cleanupCause,
				}),
			);
		}
		throw initializationError;
	}
	const lifetime = new AbortController();
	const operation = signal
		? AbortSignal.any([signal, lifetime.signal])
		: lifetime.signal;
	const abort = new AbortController();
	const commands = new Set(),
		ids = new Set();
	const volumes = new Map();
	let mountInventoryComplete = true;
	let currentContainerId;
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
		sealed = false,
		resetting = false,
		execution = 0,
		disposed = true;
	let observationError;
	let auditDeadline;
	let phase = "startup";
	const deadlineErrors = new WeakSet();
	const sdkFailures = new WeakSet();
	const controllerTimings = join(
		dirname(clientTimings),
		"s3-controller-timings.jsonl",
	);
	let auditWindow;
	let auditEnd = 0;
	const runnerTimings = join(dirname(clientTimings), "runner-timings.jsonl");
	const runnerCalls = new Map();
	let runnerWindow, activeCall, currentCall;
	let boundariesDropped = 0;
	const record = (event, details = {}) => {
		if (boundaries.length === 128) {
			boundaries.shift();
			boundariesDropped++;
		}
		const value = { event, at: Date.now(), ...details };
		boundaries.push(value);
		appendFileSync(
			controllerTimings,
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
	const diagnostic = (event, details) => {
		try {
			record(event, { phase, execution, ...details() });
		} catch (cause) {
			observationError ??= cause;
			failure ??= new Error("Owned S3 controller observation failed", {
				cause,
			});
			abort.abort();
		}
	};
	const httpStatus = (value) => {
		const status = value?.$metadata?.httpStatusCode;
		return Number.isSafeInteger(status) && status >= 100 && status <= 599
			? status
			: undefined;
	};
	const failureDetails = (error, request = {}) => {
		let category = "unknown";
		let fallback = "unknown";
		let status = request.httpStatus;
		for (let cause = error, depth = 0; cause && depth < 4; depth++) {
			status ??= httpStatus(cause);
			if (category !== "unknown") {
				cause = cause.cause;
				continue;
			}
			if (cause === observationError) category = "observation-io";
			else if (deadlineErrors.has(cause)) category = "operation-deadline";
			else if (signal?.aborted && cause === signal.reason)
				category = "parent-cancel";
			else if (lifetime.signal.aborted && cause === lifetime.signal.reason)
				category = "lifetime-abort";
			else if (request.timeout?.aborted && cause === request.timeout.reason)
				category = "per-request-timeout";
			else if (sdkFailures.has(cause) && cause.name === "AbortError")
				fallback = "sdk-abort";
			else if (
				sdkFailures.has(cause) &&
				cause.name === "CredentialsProviderError"
			)
				fallback = "sdk-credentials";
			else if (sdkFailures.has(cause) && cause.name === "ValidationError")
				fallback = "sdk-validation";
			else if (
				[
					"ECONNREFUSED",
					"ECONNRESET",
					"EPIPE",
					"ENOTFOUND",
					"ETIMEDOUT",
				].includes(cause.code)
			)
				fallback = "network";
			cause = cause.cause;
		}
		if (category === "unknown") category = fallback;
		return {
			category:
				category === "unknown" && status !== undefined
					? "http-status"
					: category,
			httpStatus: status,
			monotonic: performance.now(),
			remainingMs: Math.max(0, (auditDeadline ?? deadline) - performance.now()),
			deadlineExpired: performance.now() >= (auditDeadline ?? deadline),
			parentAborted: signal?.aborted ?? false,
			lifetimeAborted: lifetime.signal.aborted,
			resetAborted: resetAbort?.signal.aborted ?? false,
			requestTimeoutAborted: request.timeout?.aborted ?? false,
		};
	};
	// Labels and actions stay inside this family; no external diagnostic transport.
	const observe = async (label, action, request = {}) => {
		const started = performance.now();
		const observedPhase = phase;
		const details = () => ({
			phase: observedPhase,
			operation: label,
			monotonic: performance.now(),
			elapsedMs: performance.now() - started,
			remainingMs: Math.max(0, (auditDeadline ?? deadline) - performance.now()),
		});
		diagnostic("operation-start", details);
		let result, error;
		let failed = false;
		try {
			if (observationError && phase !== "cleanup") throw observationError;
			result = await action();
		} catch (cause) {
			failed = true;
			error = cause;
		}
		diagnostic("operation-finish", () => ({
			...details(),
			failed,
			...(failed
				? failureDetails(error, request)
				: { httpStatus: httpStatus(result) }),
		}));
		if (failed) throw error;
		if (observationError && phase !== "cleanup") throw observationError;
		return result;
	};
	const remaining = () => {
		operationSignal().throwIfAborted();
		const ms = Math.floor((auditDeadline ?? deadline) - performance.now());
		if (ms <= 0) {
			const error = new Error("Mutation S3 operation deadline expired");
			deadlineErrors.add(error);
			throw error;
		}
		return ms;
	};
	const docker = async (...args) => {
		if (closing && !["rm", "ps", "volume", "inspect"].includes(args[0]))
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
	const s3Operations = new Map([
		[sdk.CreateBucketCommand, "create-bucket"],
		[sdk.ListBucketsCommand, "list-buckets"],
		[sdk.GetBucketVersioningCommand, "get-bucket-versioning"],
		[sdk.ListObjectVersionsCommand, "list-object-versions"],
		[sdk.ListObjectsV2Command, "list-objects"],
		[sdk.ListMultipartUploadsCommand, "list-multipart-uploads"],
		[sdk.AbortMultipartUploadCommand, "abort-multipart-upload"],
		[sdk.DeleteObjectCommand, "delete-object"],
		[sdk.DeleteBucketCommand, "delete-bucket"],
	]);
	const send = (command) => {
		const request = {};
		return observe(
			s3Operations.get(command.constructor) ?? "unknown-s3-operation",
			async () => {
				let response;
				try {
					const upstream = operationSignal();
					request.timeout = AbortSignal.timeout(Math.min(1000, remaining()));
					request.attempted = true;
					response = await client.send(command, {
						abortSignal: AbortSignal.any([upstream, request.timeout]),
					});
				} catch (cause) {
					if (
						request.attempted &&
						cause !== null &&
						(typeof cause === "object" || typeof cause === "function")
					)
						sdkFailures.add(cause);
					const status = cause.$metadata?.httpStatusCode;
					throw new Error(
						`Owned S3 storage operation failed${Number.isSafeInteger(status) && status >= 100 && status <= 599 ? ` with HTTP ${status}` : ""}`,
						{ cause },
					);
				}
				request.httpStatus = httpStatus(response);
				if (
					response.$metadata.httpStatusCode !== 200 &&
					response.$metadata.httpStatusCode !== 204
				)
					throw new Error("Owned S3 operation returned an unexpected status");
				return response;
			},
			request,
		);
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
	const assertEmpty = (state, boundary) => {
		if (
			state.objects.length ||
			state.versions.length ||
			state.deleteMarkers.length ||
			state.uploads.length ||
			state.versioning !== "disabled"
		)
			throw new Error(`Owned S3 ${boundary} left mutable state`);
	};
	const inspectOwned = async () => {
		const inspected = JSON.parse(await docker("inspect", name));
		if (!Array.isArray(inspected) || inspected.length !== 1)
			throw new Error("Owned S3 container inventory is incomplete");
		const container = inspected[0];
		if (
			!/^[a-f0-9]{64}$/.test(container.Id) ||
			container.Name !== `/${name}` ||
			container.Config?.Labels?.["wallpaperdb.mutation"] !== name ||
			(currentContainerId && currentContainerId !== container.Id)
		)
			throw new Error("Owned S3 container identity could not be verified");
		ids.add(container.Id);
		currentContainerId = container.Id;
		mountInventoryComplete = false;
		if (!Array.isArray(container.Mounts) || container.Mounts.length !== 1)
			throw new Error("Owned S3 mount inventory is incomplete");
		const mount = container.Mounts[0];
		if (
			mount.Type !== "volume" ||
			mount.Destination !== "/data" ||
			!/^[a-f0-9]{64}$/.test(mount.Name)
		)
			throw new Error("Owned S3 anonymous volume identity is unverified");
		volumes.set(mount.Name, {
			name: mount.Name,
			type: mount.Type,
			destination: mount.Destination,
			containerId: container.Id,
		});
		mountInventoryComplete = true;
		// Context from this existing owned inspection, not proof of later liveness.
		const state = container.State ?? {};
		const runningObserved = typeof state.Running === "boolean";
		const oomKilledObserved = typeof state.OOMKilled === "boolean";
		const exitCodeObserved =
			Number.isSafeInteger(state.ExitCode) &&
			state.ExitCode >= 0 &&
			state.ExitCode <= 255;
		const statusObserved = [
			"created",
			"running",
			"paused",
			"restarting",
			"removing",
			"exited",
			"dead",
		].includes(state.Status);
		diagnostic("container-state", () => ({
			containerId: container.Id,
			runningObserved,
			oomKilledObserved,
			exitCodeObserved,
			statusObserved,
			...(runningObserved ? { running: state.Running } : {}),
			...(oomKilledObserved ? { oomKilled: state.OOMKilled } : {}),
			...(exitCodeObserved ? { exitCode: state.ExitCode } : {}),
			...(statusObserved ? { status: state.Status } : {}),
		}));
		return container;
	};
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
		try {
			record("controller-disposal", {
				complete: !error,
				sockets: [...sockets].map((socket, index) => ({
					...identities[index],
					destroyed: socket.destroyed,
					closed: socket.closed,
				})),
			});
		} catch (cause) {
			observationError ??= cause;
			error ??= cause;
		}
		if (error) throw error;
	};
	const create = async (fixedPort = "") => {
		const started = performance.now();
		mountInventoryComplete = false;
		const created = await observe("container-create", () =>
			docker(
				"create",
				"--pull=never",
				"--name",
				name,
				"--label",
				`wallpaperdb.mutation=${name}`,
				"--entrypoint",
				"/bin/sh",
				"--publish",
				`127.0.0.1:${fixedPort}:9000`,
				image,
				"-c",
				privateConfigurationEntrypoint,
				"mutation-s3",
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
			),
		);
		if (!/^[a-f0-9]{64}$/.test(created))
			throw new Error("Owned S3 create returned no container identity");
		currentContainerId = created;
		await observe("config-copy", () =>
			docker("cp", configFile, `${name}:/tmp/mutation-s3.json`),
		);
		await observe("container-start", () => docker("start", name));
		const inspected = await observe("owned-inspect", inspectOwned);
		diagnostic("image-identity", () => ({
			containerId: inspected.Id,
			imageConfigObserved: /^sha256:[a-f0-9]{64}$/.test(inspected.Image),
			...(/^sha256:[a-f0-9]{64}$/.test(inspected.Image)
				? { imageConfigId: inspected.Image }
				: {}),
		}));
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
		await observe("readiness-wait", async () => {
			while (true) {
				remaining();
				try {
					const logs = await docker("logs", "--tail", "80", name);
					if (
						!logs.includes(
							"All enabled components are running and ready to use:",
						)
					)
						throw new Error("S3 startup is not ready");
					break;
				} catch {
					await delay(Math.min(50, remaining()), undefined, {
						signal: operationSignal(),
					});
				}
			}
		});
		await send(new sdk.CreateBucketCommand({ Bucket: "assets" }));
		const state = await bucketState();
		assertEmpty(state, "startup");
		timings.startupSeconds += (performance.now() - started) / 1000;
		record("backend-started", {
			containerId: inspected.Id,
			volume: volumes.get(inspected.Mounts[0].Name),
		});
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
			await docker("rm", "--force", "--volumes", currentContainerId);
			currentContainerId = undefined;
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
		assertEmpty(clean, "reset");
		record("after-reset", {
			execution: execution + 1,
			...summarizeState(clean),
		});
	};
	// Consume complete new records, without capping the retained cumulative history.
	const readRunnerCalls = () => {
		const fd = openSync(
			runnerTimings,
			constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
		);
		let error;
		try {
			const before = fstatSync(fd);
			const offset = runnerWindow?.offset ?? 0;
			if (
				!before.isFile() ||
				!Number.isSafeInteger(before.size) ||
				before.size < offset ||
				(runnerWindow &&
					(before.dev !== runnerWindow.dev || before.ino !== runnerWindow.ino))
			)
				throw new Error("Owned S3 runner history identity changed");
			const length = before.size - offset;
			if (length > 1024 * 1024)
				throw new Error("Owned S3 runner observation exceeds its window");
			const bytes = Buffer.alloc(length);
			let size = 0;
			while (size < length) {
				const count = readSync(fd, bytes, size, length - size, offset + size);
				if (!count) break;
				size += count;
			}
			const after = fstatSync(fd);
			if (
				size !== length ||
				after.size !== before.size ||
				after.mtimeMs !== before.mtimeMs ||
				after.ctimeMs !== before.ctimeMs ||
				(length && bytes[length - 1] !== 10)
			)
				throw new Error("Incomplete S3 runner observation");
			for (const line of length
				? bytes.toString("utf8").slice(0, -1).split("\n")
				: []) {
				const row = JSON.parse(line);
				const match =
					typeof row?.id === "string" &&
					/^(\d+):(coverageCollectionSeconds|mutationExecutionSeconds):\d+(?:\.\d+)?$/.exec(
						row.id,
					);
				const pid = match && Number(match[1]);
				if (
					!match ||
					row.id.length > 256 ||
					!Number.isSafeInteger(pid) ||
					pid < 1 ||
					row.phase !== match[2] ||
					!Number.isFinite(row.at) ||
					row.at <= 0 ||
					(row.phase === "mutationExecutionSeconds"
						? typeof row.mutation !== "string" ||
							!/^\d{1,128}$/.test(row.mutation)
						: row.mutation !== undefined)
				)
					throw new Error("Malformed S3 runner call identity");
				if (row.seconds === undefined) {
					if (
						runnerCalls.has(row.id) ||
						activeCall ||
						row.endedAt !== undefined
					)
						throw new Error("Ambiguous S3 runner call start");
					activeCall = {
						id: row.id,
						pid,
						phase: row.phase,
						mutation: row.mutation,
						at: row.at,
						ended: false,
						execution: null,
						acknowledged: false,
					};
					runnerCalls.set(row.id, activeCall);
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
						throw new Error("Unmatched S3 runner call end");
					activeCall.ended = true;
					activeCall = undefined;
				}
			}
			runnerWindow = { dev: before.dev, ino: before.ino, offset: before.size };
		} catch (cause) {
			error = cause;
		} finally {
			try {
				closeSync(fd);
			} catch (cause) {
				error = error
					? new AggregateError(
							[error, cause],
							"S3 runner observation and descriptor cleanup failed",
							{ cause: error },
						)
					: cause;
			}
		}
		if (error) {
			observationError ??= error;
			throw new Error("Owned S3 runner observation failed", { cause: error });
		}
	};
	const bindRunnerCall = () => {
		readRunnerCalls();
		if (
			!activeCall ||
			activeCall.execution !== null ||
			activeCall.phase !==
				(execution === 0
					? "coverageCollectionSeconds"
					: "mutationExecutionSeconds")
		)
			throw new Error("Missing or ambiguous S3 execution runner binding");
		currentCall = activeCall;
		currentCall.execution = execution + 1;
		try {
			record("execution-binding", {
				execution: execution + 1,
				call: currentCall.id,
				workerPid: currentCall.pid,
				phase: currentCall.phase,
				...(currentCall.mutation === undefined
					? {}
					: { nativeMutation: currentCall.mutation }),
				window: { ...auditWindow },
			});
		} catch (cause) {
			observationError ??= cause;
			throw new Error("Owned S3 execution binding observation failed", {
				cause,
			});
		}
	};
	const beginAuditWindow = () => {
		const descriptor = openSync(
			clientTimings,
			constants.O_RDONLY |
				constants.O_CREAT |
				constants.O_NOFOLLOW |
				constants.O_NONBLOCK,
			0o600,
		);
		try {
			const stat = fstatSync(descriptor);
			if (
				!stat.isFile() ||
				!Number.isSafeInteger(stat.size) ||
				stat.size < auditEnd ||
				(auditWindow &&
					(stat.dev !== auditWindow.dev || stat.ino !== auditWindow.ino))
			)
				throw new Error("Owned S3 observation identity or history changed");
			if (stat.size > 0) {
				const last = Buffer.alloc(1);
				if (
					readSync(descriptor, last, 0, 1, stat.size - 1) !== 1 ||
					last[0] !== 10
				)
					throw new Error("Incomplete S3 observation history boundary");
			}
			auditWindow = {
				dev: stat.dev,
				ino: stat.ino,
				offset: stat.size,
				execution: execution + 1,
			};
			auditEnd = stat.size;
		} finally {
			closeSync(descriptor);
		}
		record("audit-window", { ...auditWindow });
	};
	const clientObservations = () => {
		if (!auditWindow || auditWindow.execution !== execution)
			throw new Error("Missing S3 current execution observation window");
		const descriptor = openSync(
			clientTimings,
			constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
		);
		let text;
		try {
			const before = fstatSync(descriptor);
			if (
				!before.isFile() ||
				before.dev !== auditWindow.dev ||
				before.ino !== auditWindow.ino ||
				!Number.isSafeInteger(before.size) ||
				before.size < auditEnd
			)
				throw new Error("Owned S3 observation identity or history changed");
			const length = before.size - auditWindow.offset;
			if (length > 1024 * 1024)
				throw new Error("S3 current execution observation exceeds its limit");
			const buffer = Buffer.alloc(1024 * 1024 + 1);
			let size = 0;
			while (size < length) {
				const count = readSync(
					descriptor,
					buffer,
					size,
					length - size,
					auditWindow.offset + size,
				);
				if (!count) break;
				size += count;
			}
			const after = fstatSync(descriptor);
			if (
				size !== length ||
				after.size !== before.size ||
				(size > 0 && buffer[size - 1] !== 10)
			)
				throw new Error("Incomplete S3 current execution observation");
			text = buffer.subarray(0, size).toString("utf8");
			auditEnd = before.size;
		} finally {
			closeSync(descriptor);
		}
		return text ? text.slice(0, -1).split("\n").map(JSON.parse) : [];
	};
	const disposalReceipt = () => {
		const observations = clientObservations();
		const rows = observations.filter(
			(row) => row.execution === execution && row.event === "disposal-audit",
		);
		if (rows.length !== 1)
			throw new Error("Missing or ambiguous S3 client audit");
		const row = rows[0];
		if (
			observations.some(
				(entry) =>
					entry.execution !== execution ||
					entry.pid !== row.pid ||
					entry.threadId !== row.threadId,
			) ||
			!Number.isSafeInteger(row.pid) ||
			row.pid <= 0 ||
			row.pid !== currentCall?.pid ||
			currentCall.execution !== execution ||
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
			window: { ...auditWindow, end: auditEnd },
			clientIds: row.clients.map((entry) => entry.id),
			complete: true,
			applicationClientIds: application.clientIds,
			ordinaryTestFailed: application.failed,
		};
	};
	const remove = async () => {
		let error;
		try {
			await inspectOwned();
		} catch (cause) {
			if (!cause.missingContainer) error = cause;
		}
		// A failed mount observation cannot skip deletion of an independently
		// verified owned container. Never delete by an unverified name or ID.
		if (currentContainerId && ids.has(currentContainerId)) {
			try {
				await docker("rm", "--force", "--volumes", currentContainerId);
			} catch (cause) {
				if (!cause.missingContainer) error ??= cause;
			}
		}
		const audit = {
			complete: false,
			scope: "exact-owner-container-label-and-verified-mounts",
			containersComplete: false,
			containerIds: null,
			volumes: { complete: false, owned: [...volumes.values()], present: null },
		};
		try {
			const listed = await docker(
				"ps",
				"-aq",
				"--no-trunc",
				"--filter",
				`label=wallpaperdb.mutation=${name}`,
			);
			const remaining = listed ? listed.split("\n") : [];
			if (
				remaining.some((id) => !/^[a-f0-9]{64}$/.test(id) || !ids.has(id)) ||
				new Set(remaining).size !== remaining.length
			)
				throw new Error("Owned S3 container absence audit is incomplete");
			audit.containerIds = remaining;
			audit.containersComplete = true;
		} catch (cause) {
			error ??= cause;
		}
		try {
			// One complete bounded listing, even after many isolated executions. Do
			// not inspect/delete historical volumes or publish unrelated daemon names.
			const listed = await docker("volume", "ls", "--format", "{{.Name}}");
			const names = listed ? listed.split("\n") : [];
			if (
				names.some((value) => !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value)) ||
				new Set(names).size !== names.length
			)
				throw new Error("Owned S3 volume absence audit is incomplete");
			audit.volumes.present = names.filter((value) => volumes.has(value));
			audit.volumes.complete = mountInventoryComplete;
		} catch (cause) {
			error ??= cause;
		}
		audit.complete = audit.containersComplete && audit.volumes.complete;
		const passed =
			!error &&
			audit.complete &&
			audit.containerIds?.length === 0 &&
			audit.volumes.present?.length === 0;
		try {
			record("resource-audit", { ...audit, passed });
		} catch (cause) {
			observationError ??= cause;
			error ??= cause;
		}
		return { audit: { ...audit, passed: passed && !error }, error };
	};
	const pendingExecution = (context) => {
		const result = context?.result;
		const shutdown = result?.shutdown;
		const receipts = shutdown?.receipts;
		if (
			result?.outcome !== "budget-exhausted" ||
			shutdown?.confirmed !== true ||
			shutdown.failure ||
			shutdown.platform !== "linux" ||
			!Number.isSafeInteger(shutdown.pid) ||
			shutdown.pid < 1 ||
			shutdown.pgid !== shutdown.pid ||
			shutdown.sid !== shutdown.pid ||
			typeof shutdown.startTicks !== "string" ||
			!/^\d+$/.test(shutdown.startTicks) ||
			!Number.isSafeInteger(shutdown.leaderPid) ||
			shutdown.leaderPid < 1 ||
			!Array.isArray(receipts) ||
			receipts.length > 24 ||
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
			receipts.some((row) => row.event === "failure") ||
			typeof context.assertHealthy !== "function" ||
			typeof context.reports !== "function"
		)
			throw new Error("Missing S3 normal-budget owned-group proof");
		context.assertHealthy();
		if (
			failure ||
			observationError ||
			abort.signal.aborted ||
			operation.aborted
		)
			throw new Error(
				"Owned S3 budget finalization has prior failure evidence",
			);
		readRunnerCalls();
		if (
			!currentCall ||
			currentCall !== activeCall ||
			currentCall.execution !== execution ||
			currentCall.ended ||
			currentCall.acknowledged ||
			currentCall.phase !== "mutationExecutionSeconds" ||
			execution < 2 ||
			[...runnerCalls.values()].some(
				(call) =>
					call !== currentCall &&
					(!call.ended || !call.acknowledged || call.execution === null),
			)
		)
			throw new Error(
				"Missing S3 unfinished execution or prior acknowledgement proof",
			);
		const nativeIndex = (report) => {
			const byNative = new Map(),
				byStable = new Map();
			if (
				!report ||
				typeof report.files !== "object" ||
				!report.files ||
				Array.isArray(report.files)
			)
				throw new Error("Malformed S3 native report");
			for (const [name, file] of Object.entries(report.files)) {
				if (typeof file?.source !== "string" || !Array.isArray(file.mutants))
					throw new Error("Malformed S3 native source");
				for (const mutant of file.mutants) {
					if (
						typeof mutant?.id !== "string" ||
						!mutant.id ||
						mutant.id.length > 256 ||
						typeof mutant.mutatorName !== "string" ||
						typeof mutant.replacement !== "string" ||
						typeof mutant.status !== "string" ||
						["start", "end"].some((end) =>
							["line", "column"].some(
								(key) =>
									!Number.isSafeInteger(mutant.location?.[end]?.[key]) ||
									mutant.location[end][key] < 1,
							),
						)
					)
						throw new Error("Malformed S3 native mutation identity");
					const stable = mutationId(name, file.source, mutant);
					if (
						byNative.has(mutant.id) ||
						byStable.has(stable) ||
						mutant.status === "RuntimeError" ||
						mutant.conflictingStatuses
					)
						throw new Error("Ambiguous or failed S3 native result");
					const row = { stable, mutant };
					byNative.set(mutant.id, row);
					byStable.set(stable, row);
				}
			}
			return { byNative, byStable };
		};
		const reports = context.reports();
		const planned = nativeIndex(reports.planned);
		const partial = reports.partial ? nativeIndex(reports.partial) : undefined;
		const initial = reports.initial ? nativeIndex(reports.initial) : undefined;
		for (const report of [reports.partial, reports.initial]) {
			for (const [name, file] of Object.entries(report?.files ?? {})) {
				if (
					reports.planned.files[name] &&
					file.source !== reports.planned.files[name].source
				)
					throw new Error("Owned S3 native report source changed");
			}
		}
		const pending = planned.byNative.get(currentCall.mutation);
		if (
			!pending ||
			pending.mutant.status !== "Pending" ||
			[initial, partial].some(
				(index) =>
					index?.byStable.has(pending.stable) &&
					index.byStable.get(pending.stable).mutant.status !== "Pending",
			)
		)
			throw new Error(
				"Owned S3 interrupted mutation is not unaccepted Pending work",
			);
		for (const call of runnerCalls.values()) {
			if (call === currentCall || call.phase === "coverageCollectionSeconds")
				continue;
			const identity = planned.byNative.get(call.mutation);
			const terminal =
				identity && partial?.byStable.get(identity.stable)?.mutant;
			if (!terminal || !isProcessed(terminal) || terminal.status === "Timeout")
				throw new Error("Missing S3 acknowledged native terminal result");
		}
		const observations = clientObservations();
		let thread;
		const created = new Set();
		let helperReady = false,
			application = false;
		for (const row of observations) {
			if (
				!row ||
				row.execution !== execution ||
				row.pid !== currentCall.pid ||
				!Number.isSafeInteger(row.threadId) ||
				row.threadId < 0 ||
				(thread !== undefined && row.threadId !== thread) ||
				!Number.isFinite(row.at) ||
				row.at <= 0 ||
				(row.phase === undefined) === (row.event === undefined)
			)
				throw new Error("Incomplete S3 interrupted worker observation");
			thread = row.threadId;
			if (row.phase === "created" && row.event === undefined) {
				if (
					!Number.isSafeInteger(row.sdkClientId) ||
					row.sdkClientId < 1 ||
					created.has(row.sdkClientId) ||
					!Number.isFinite(row.seconds) ||
					row.seconds < 0
				)
					throw new Error("Ambiguous S3 interrupted SDK creation");
				created.add(row.sdkClientId);
				if (created.size > 1024)
					throw new Error(
						"Owned S3 interrupted SDK observation exceeds its limit",
					);
			} else if (row.event === "helper-ready") {
				if (
					helperReady ||
					created.size !== 1 ||
					!Number.isFinite(row.seconds) ||
					row.seconds < 0
				)
					throw new Error("Incomplete S3 interrupted helper observation");
				helperReady = true;
			} else if (row.event === "sdk-destroy-return") {
				if (
					!created.has(row.sdkClientId) ||
					!Number.isFinite(row.seconds) ||
					row.seconds < 0
				)
					throw new Error("Incomplete S3 interrupted SDK release observation");
			} else if (row.event === "application-observation") {
				if (
					application ||
					row.complete !== true ||
					typeof row.failed !== "boolean" ||
					!created.has(row.helperClientId) ||
					!Array.isArray(row.clientIds) ||
					new Set(row.clientIds).size !== row.clientIds.length ||
					row.clientIds.some(
						(id) => id === row.helperClientId || !created.has(id),
					) ||
					(!row.failed && row.clientIds.length !== 1)
				)
					throw new Error("Incomplete S3 interrupted application observation");
				application = true;
			} else {
				// Even a completed passing audit cannot replace its controller ACK.
				throw new Error(
					"Owned S3 interrupted execution has disposal or unknown observation evidence",
				);
			}
		}
		context.assertHealthy();
		return {
			disposition: "interrupted-pending",
			execution,
			call: currentCall.id,
			nativeMutation: currentCall.mutation,
			mutation: pending.stable,
			accepted: false,
			disposed: false,
			cooperativeDisposalObserved: false,
			groupShutdownConfirmed: true,
			acknowledgedExecutions: execution - 1,
			observationWindow: { ...auditWindow, end: auditEnd },
		};
	};
	const close = (context) => {
		closePromise ??= (async () => {
			sealed = true;
			phase = "cleanup";
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
					let interrupted;
					if (!disposed) {
						if (!context) verifyDisposal();
						try {
							interrupted = pendingExecution(context);
						} catch (cause) {
							throw new Error("Owned S3 pending finalization proof failed", {
								cause,
							});
						}
					}
					if (!interrupted) verifyDisposal();
					const state = await bucketState();
					recordFinal("finalAudit", "final-audit", {
						status: "PASSED",
						execution,
						disposed,
						...summarizeState(state),
						...(interrupted ? { interrupted } : {}),
						scope: interrupted
							? "owned-backend-state-and-stopped-pending-owner"
							: "owned-backend-state-and-acknowledged-sdk-disposal",
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
			} catch (cause) {
				error ??= cause;
			}
			try {
				await stopClient();
			} catch (cause) {
				error ??= cause;
			}
			try {
				await Promise.all([...commands]);
				await resetDone;
			} catch (cause) {
				error ??= cause;
			} finally {
				try {
					const removal = await remove();
					resources = removal.audit;
					error ??= removal.error;
					if (!resources.passed)
						error ??= new Error("Owned S3 resource audit failed");
				} catch (cause) {
					error ??= cause;
				} finally {
					clearTimeout(timer);
					try {
						rmSync(directory, { recursive: true, force: true });
					} catch (cause) {
						error ??= new Error(
							"Owned S3 private configuration cleanup failed",
							{
								cause,
							},
						);
					}
					if (context) {
						try {
							context.assertHealthy();
							if (failure || observationError || abort.signal.aborted)
								error ??= new Error("Owned S3 finalization failed after drain");
						} catch (cause) {
							error ??= cause;
						}
					}
					timings.teardownSeconds = (performance.now() - started) / 1000;
					recordFinal("closeEnd", "close-end", {
						failed: Boolean(error || observationError),
						observationFailed: Boolean(observationError),
						teardownSeconds: timings.teardownSeconds,
						resources: resources ?? {
							complete: false,
							scope: "exact-owner-container-label-and-verified-mounts",
							containersComplete: false,
							volumes: { complete: false },
						},
					});
				}
			}
			if (error || observationError)
				diagnostic("cleanup-failure", () => ({
					failed: true,
					...failureDetails(error ?? observationError),
				}));
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
			await observe("image-inspect", () => docker("image", "inspect", image));
		} catch (error) {
			if (!error.missingImage) throw error;
			await observe("image-pull", () => docker("pull", image));
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
			if (
				request.url === "/failure" ||
				closing ||
				sealed ||
				resetting ||
				failure
			) {
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
						// The serial worker cannot write this execution until its reset reply.
						beginAuditWindow();
						bindRunnerCall();
						execution++;
						disposed = false;
						timings.resets++;
						timings.resetSeconds += (performance.now() - started) / 1000;
						response.writeHead(200).end(String(execution));
					} else {
						const audit = disposalReceipt();
						if (disposed) throw new Error("Duplicate owned S3 disposal");
						disposed = true;
						currentCall.acknowledged = true;
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
					try {
						record("operation-end", {
							operation: request.url === "/reset" ? "reset" : "disposed",
							execution,
							failed: Boolean(failure),
						});
					} catch (cause) {
						observationError ??= cause;
						failure ??= new Error("Owned S3 controller observation failed", {
							cause,
						});
						abort.abort();
					} finally {
						resetting = false;
						resetAbort = undefined;
					}
				}
			})().catch((cause) => {
				// Attach immediately: even an unexpected response/observer error must
				// settle the drain promise and stop native work before publication.
				failure ??= new Error("Owned S3 controller request failed", { cause });
				abort.abort();
				response.destroy();
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
		diagnostic("startup-failure", () => ({
			failed: true,
			...failureDetails(error),
		}));
		try {
			await close();
		} catch (cleanupError) {
			throw new FixtureCleanupError(error, cleanupError);
		}
		throw error;
	}
}

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { FixtureCleanupError } from "./mutation-fixture.mjs";

const execute = promisify(execFile);

/** One serial publication owner, with a private server and no shared reaper. */
export async function natsFixture(cwd, image, deadline, cleanupMs, signal) {
	if (!/^nats(?::[a-zA-Z0-9_.-]+)?@sha256:[a-f0-9]{64}$/.test(image))
		throw new Error("Mutation NATS requires an immutable fixtureImage digest");
	const { connect } = createRequire(join(cwd, "package.json"))("nats");
	const name = `wallpaperdb-mutation-${randomUUID()}`;
	const token = randomUUID();
	const lifetime = new AbortController();
	const operation = signal
		? AbortSignal.any([signal, lifetime.signal])
		: lifetime.signal;
	const abort = new AbortController();
	const commands = new Set();
	const ids = new Set();
	const boundaries = [];
	const timings = {
		startupSeconds: 0,
		resets: 0,
		resetSeconds: 0,
		initializationSeconds: 0,
		teardownSeconds: 0,
	};
	let connection, manager, port, monitorPort, server, failure;
	let closing = false,
		resetting = false;
	let closePromise, resetDone, resetAbort, cleanupDeadline;
	const record = (event, details = {}) => {
		if (boundaries.length === 128) {
			const empty = boundaries.findIndex(
				(entry) =>
					!entry.clients?.length && !entry.streams?.length && !entry.failed,
			);
			boundaries.splice(Math.max(0, empty), 1);
		}
		boundaries.push({
			event,
			at: Date.now(),
			remainingMs: Math.floor(deadline - performance.now()),
			...details,
		});
	};
	const remaining = () => {
		operation.throwIfAborted();
		resetAbort?.signal.throwIfAborted();
		const ms = Math.floor(deadline - performance.now());
		if (ms <= 0) throw new Error("Mutation NATS stage deadline expired");
		return ms;
	};
	const operationSignal = () =>
		resetAbort ? AbortSignal.any([operation, resetAbort.signal]) : operation;
	const docker = async (...args) => {
		if (closing && args[0] !== "rm")
			throw new Error("Owned NATS fixture is closing");
		const request = execute("docker", args, {
			encoding: "utf8",
			timeout: closing
				? Math.max(1, Math.floor(cleanupDeadline - performance.now()))
				: Math.min(args[0] === "pull" ? Infinity : 10_000, remaining()),
			signal: closing ? undefined : operationSignal(),
			killSignal: "SIGKILL",
			maxBuffer: 1024 * 1024,
		});
		const closed = new Promise((resolve) =>
			request.child.once("close", resolve),
		);
		commands.add(closed);
		try {
			return (await request).stdout.trim();
		} finally {
			await closed;
			commands.delete(closed);
		}
	};
	const monitor = async (path) => {
		const response = await fetch(`http://127.0.0.1:${monitorPort}${path}`, {
			signal: AbortSignal.any([
				operationSignal(),
				AbortSignal.timeout(Math.min(1000, remaining())),
			]),
		});
		if (!response.ok) throw new Error("Owned NATS monitoring failed");
		return response.json();
	};
	const verifyNoClients = async (boundary) => {
		await manager.getAccountInfo();
		const snapshot = await monitor(
			"/connz?state=open&subs=1&offset=0&limit=1024",
		);
		const cid = connection.info?.client_id;
		if (
			!Number.isSafeInteger(cid) ||
			cid <= 0 ||
			connection.isClosed() ||
			typeof snapshot.server_id !== "string" ||
			!snapshot.server_id ||
			snapshot.offset !== 0 ||
			snapshot.limit !== 1024 ||
			!Number.isSafeInteger(snapshot.total) ||
			snapshot.total < 1 ||
			snapshot.num_connections !== snapshot.total ||
			snapshot.server_id !== connection.info?.server_id ||
			!Array.isArray(snapshot.connections) ||
			snapshot.total !== snapshot.connections.length ||
			new Set(snapshot.connections.map((client) => client.cid)).size !==
				snapshot.total ||
			snapshot.connections.some(
				(client) =>
					!Number.isSafeInteger(client.cid) ||
					client.cid <= 0 ||
					!Number.isSafeInteger(client.subscriptions) ||
					client.subscriptions < 0,
			) ||
			snapshot.connections.filter((client) => client.cid === cid).length !== 1
		)
			throw new Error(
				"Owned NATS client audit identity or completeness failed",
			);
		// JetStream's internal resources are not client-protocol connections. Only
		// the exact controller CID is exempt; a matching client name grants nothing.
		const clients = snapshot.connections
			.filter((client) => client.cid !== cid)
			.map(({ cid, name, subscriptions, pending_bytes }) => ({
				cid,
				name,
				subscriptions,
				pending_bytes,
			}));
		record("client-audit", {
			boundary,
			serverId: snapshot.server_id,
			controllerCid: cid,
			total: snapshot.total,
			offset: snapshot.offset,
			limit: snapshot.limit,
			returned: snapshot.num_connections,
			clients,
		});
		if (clients.length)
			throw new Error(`${boundary} leaked ${clients.length} NATS clients`);
	};
	const disconnect = async () => {
		if (connection) await connection.close();
	};
	const interrupted = () => {
		void disconnect().catch(() => {});
	};
	operation.addEventListener("abort", interrupted, { once: true });
	const create = async (fixedPort = "", fixedMonitorPort = "") => {
		const started = performance.now();
		await docker(
			"create",
			"--pull=never",
			"--name",
			name,
			"--label",
			`wallpaperdb.mutation=${name}`,
			"--publish",
			`127.0.0.1:${fixedPort}:4222`,
			"--publish",
			`127.0.0.1:${fixedMonitorPort}:8222`,
			image,
			"-js",
			"-m",
			"8222",
			"-n",
			name,
		);
		await docker("start", name);
		const inspected = JSON.parse(await docker("inspect", name))[0];
		ids.add(inspected.Id);
		port = Number(inspected.NetworkSettings.Ports["4222/tcp"][0].HostPort);
		monitorPort = Number(
			inspected.NetworkSettings.Ports["8222/tcp"][0].HostPort,
		);
		while (true) {
			remaining();
			try {
				await monitor("/healthz");
				connection = await connect({
					servers: `nats://127.0.0.1:${port}`,
					name: "mutation-controller",
					reconnect: false,
					timeout: Math.min(1000, remaining()),
				});
				remaining();
				manager = await connection.jetstreamManager({ timeout: 1000 });
				await verifyNoClients("Server startup");
				break;
			} catch {
				await disconnect();
				await delay(Math.min(50, remaining()), undefined, {
					signal: operationSignal(),
				});
			}
		}
		timings.startupSeconds += (performance.now() - started) / 1000;
	};
	const streamState = async () => {
		const streams = [];
		for await (const stream of manager.streams.list()) {
			const consumers = [];
			for await (const consumer of manager.consumers.list(stream.config.name)) {
				consumers.push({
					name: consumer.name,
					config: {
						durable_name: consumer.config.durable_name,
						ack_policy: consumer.config.ack_policy,
						ack_wait: consumer.config.ack_wait,
						max_deliver: consumer.config.max_deliver,
						filter_subject: consumer.config.filter_subject,
						deliver_policy: consumer.config.deliver_policy,
						replay_policy: consumer.config.replay_policy,
						max_ack_pending: consumer.config.max_ack_pending,
					},
					delivered: consumer.delivered,
					ack_floor: consumer.ack_floor,
					num_ack_pending: consumer.num_ack_pending,
					num_redelivered: consumer.num_redelivered,
					num_pending: consumer.num_pending,
				});
			}
			streams.push({
				name: stream.config.name,
				config: {
					subjects: stream.config.subjects,
					retention: stream.config.retention,
					storage: stream.config.storage,
					discard: stream.config.discard,
					max_msgs: stream.config.max_msgs,
					max_bytes: stream.config.max_bytes,
					max_age: stream.config.max_age,
					max_msg_size: stream.config.max_msg_size,
					max_consumers: stream.config.max_consumers,
					duplicate_window: stream.config.duplicate_window,
				},
				state: stream.state,
				consumers,
			});
		}
		return streams;
	};
	const reset = async () => {
		await verifyNoClients("Previous mutation");
		const streams = await streamState();
		record("before-reset", { streams });
		// Per-execution isolation remains the default until NATS's own acceptance.
		if (process.env.MUTATION_NATS_ISOLATED !== "0") {
			await disconnect();
			await docker("rm", "--force", "--volumes", name);
			await create(String(port), String(monitorPort));
		} else {
			// Deleting the stream also removes durable/ephemeral consumers, pending
			// acks, redelivery state, sequence positions, deduplication and config.
			for (const stream of streams) await manager.streams.delete(stream.name);
		}
		if ((await streamState()).length)
			throw new Error("Owned NATS reset left streams");
		const started = performance.now();
		const info = await manager.streams.add({
			name: "WALLPAPER",
			subjects: [
				"wallpaper.*",
				"wallpaper.*.*",
				"wallpaper.*.*.*",
				"wallpaper.*.*.*.*",
				"wallpaper.*.*.*.*.*",
			],
		});
		timings.initializationSeconds += (performance.now() - started) / 1000;
		if (
			info.state.messages !== 0 ||
			info.state.consumer_count !== 0 ||
			info.state.last_seq !== 0
		)
			throw new Error("Owned NATS initialization left mutable state");
		record("after-reset", { streams: await streamState() });
	};
	const close = () => {
		closePromise ??= (async () => {
			const started = performance.now();
			cleanupDeadline = started + cleanupMs;
			record("close-start", { resetting });
			const timer = setTimeout(
				() => {
					lifetime.abort();
					void disconnect();
				},
				Math.max(1, cleanupMs - Math.min(1000, cleanupMs / 3)),
			);
			let error;
			try {
				await resetDone;
				if (connection && !failure && !operation.aborted)
					await verifyNoClients("Final mutation");
			} catch (cause) {
				error = cause;
			}
			closing = true;
			lifetime.abort();
			try {
				server?.closeAllConnections();
				if (server?.listening)
					await new Promise((resolve) => server.close(resolve));
				await disconnect();
				await Promise.all([...commands]);
				await resetDone;
			} catch (cause) {
				error ??= cause;
			} finally {
				try {
					await docker("rm", "--force", "--volumes", name);
				} catch (cause) {
					if (!cause.stderr?.includes("No such container")) error ??= cause;
				} finally {
					clearTimeout(timer);
					operation.removeEventListener("abort", interrupted);
					timings.teardownSeconds = (performance.now() - started) / 1000;
					record("close-end", { failed: Boolean(error) });
				}
			}
			if (error) throw error;
		})();
		return closePromise;
	};
	try {
		try {
			await docker("image", "inspect", image);
		} catch (error) {
			if (!error.stderr?.includes("No such image")) throw error;
			await docker("pull", image);
		}
		await create();
		server = createServer((request, response) => {
			if (
				request.method !== "POST" ||
				request.headers.authorization !== `Bearer ${token}` ||
				!["/reset", "/disposed", "/failure"].includes(request.url)
			) {
				response.writeHead(404).end();
				return;
			}
			if (request.url === "/failure" || closing || resetting || failure) {
				failure ??= new Error(
					"Owned NATS application disposal failed or fixture unavailable",
				);
				abort.abort();
				response.writeHead(503).end();
				return;
			}
			resetting = true;
			resetDone = (async () => {
				const started = performance.now();
				resetAbort = new AbortController();
				const timer = setTimeout(
					() => {
						failure ??= new Error("Owned NATS reset/disposal deadline expired");
						record("operation-deadline", { failed: true });
						resetAbort.abort();
						abort.abort();
						void disconnect();
					},
					Math.min(5000, Math.max(1, deadline - performance.now())),
				);
				try {
					if (request.url === "/reset") {
						if (
							process.env.MUTATION_NATS_RESET_FAILURE === "1" ||
							(process.env.MUTATION_NATS_RESET_FAILURE === "after-progress" &&
								timings.resets >= 2)
						)
							throw new Error("Requested NATS reset-failure diagnostic");
						await reset();
						remaining();
						if (failure) throw failure;
						timings.resets++;
						timings.resetSeconds += (performance.now() - started) / 1000;
					} else await verifyNoClients("Mutation disposal");
					response.writeHead(200).end();
				} catch (error) {
					failure ??= error;
					response.writeHead(503).end();
					abort.abort();
				} finally {
					clearTimeout(timer);
					record("operation-end", {
						operation: request.url,
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
			get failure() {
				return failure;
			},
			failureSignal: abort.signal,
			env: {
				WALLPAPERDB_MUTATION_NATS_URL: `nats://127.0.0.1:${port}`,
				WALLPAPERDB_MUTATION_NATS_RESET: `http://127.0.0.1:${server.address().port}/reset`,
				WALLPAPERDB_MUTATION_NATS_TOKEN: token,
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

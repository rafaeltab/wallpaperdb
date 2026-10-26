import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

const execute = promisify(execFile);

export class FixtureCleanupError extends AggregateError {
	constructor(startupError, cleanupError) {
		super(
			[startupError, cleanupError],
			`Owned fixture startup cleanup failed: ${cleanupError.message}`,
			{ cause: startupError },
		);
	}
}

// The stage owns this small interface; instrumented suites borrow only env.
export async function mutationFixture(
	cwd,
	config,
	deadline,
	cleanupMs,
	signal,
	cancelAfterNativeProgress,
	clientTimings,
) {
	if (!config.fixture) return undefined;
	if (config.fixture === "opensearch-owned") {
		const { opensearchFixture } = await import("./mutation-opensearch.mjs");
		return opensearchFixture(
			cwd,
			config.fixtureImage,
			deadline,
			cleanupMs,
			signal,
			cancelAfterNativeProgress,
			clientTimings,
		);
	}
	if (config.fixture === "redis-owned-reuse")
		return redisFixture(cwd, config.fixtureImage, deadline, cleanupMs, signal);
	if (config.fixture === "postgres-owned") {
		const { postgresFixture } = await import("./mutation-postgres.mjs");
		return postgresFixture(
			cwd,
			config.fixtureImage,
			deadline,
			cleanupMs,
			signal,
		);
	}
	if (config.fixture === "nats-owned") {
		const { natsFixture } = await import("./mutation-nats.mjs");
		return natsFixture(
			cwd,
			config.fixtureImage,
			deadline,
			cleanupMs,
			signal,
			cancelAfterNativeProgress,
		);
	}
	if (config.fixture === "s3-owned") {
		const { s3Fixture } = await import("./mutation-s3.mjs");
		return s3Fixture(
			cwd,
			config.fixtureImage,
			deadline,
			cleanupMs,
			signal,
			cancelAfterNativeProgress,
			clientTimings,
		);
	}
	throw new Error(`Unsupported mutation fixture: ${config.fixture}`);
}

/** Physical Redis belongs to this stage, not Vitest's repeated module lifetime. */
export async function redisFixture(
	cwd,
	image,
	deadline = performance.now() + 30_000,
	cleanupMs = 5000,
	signal,
) {
	if (!/^redis(?::[a-zA-Z0-9_.-]+)?@sha256:[a-f0-9]{64}$/.test(image))
		throw new Error("Mutation Redis requires an immutable fixtureImage digest");
	const name = `wallpaperdb-mutation-${randomUUID()}`;
	let closing = false;
	const lifetime = new AbortController();
	const operationSignal = signal
		? AbortSignal.any([signal, lifetime.signal])
		: lifetime.signal;
	const activeCommands = new Set();
	const remainingMs = () => {
		operationSignal.throwIfAborted();
		const remaining = Math.floor(deadline - performance.now());
		if (remaining <= 0)
			throw new Error("Mutation Redis stage deadline expired");
		return remaining;
	};
	const docker = async (...args) => {
		if (closing && args[0] !== "rm")
			throw new Error("Owned mutation fixture is closing");
		const cleanup = closing;
		const request = execute("docker", args, {
			encoding: "utf8",
			timeout: closing
				? Math.max(1, Math.floor(cleanupMs))
				: args[0] === "pull"
					? remainingMs()
					: Math.min(10_000, remainingMs()),
			signal: cleanup ? undefined : operationSignal,
			killSignal: "SIGKILL",
		});
		// Abort can reject before close. Reap the CLI before owned cleanup starts.
		const closed = new Promise((resolve) =>
			request.child.once("close", resolve),
		);
		if (!cleanup) activeCommands.add(closed);
		try {
			return (await request).stdout.trim();
		} finally {
			await closed;
			activeCommands.delete(closed);
		}
	};
	const timings = {
		startupSeconds: 0,
		resets: 0,
		resetSeconds: 0,
		teardownSeconds: 0,
	};
	const start = performance.now();
	let client, server, failure;
	const containerIds = new Set();
	const isolated = process.env.MUTATION_REDIS_ISOLATED === "1";
	const Redis = createRequire(join(cwd, "package.json"))("ioredis");
	const create = async (fixedPort = "") => {
		await docker(
			"create",
			"--pull=never",
			"--name",
			name,
			"--label",
			`wallpaperdb.mutation=${name}`,
			"--publish",
			`127.0.0.1:${fixedPort}:6379`,
			image,
		);
		await docker("start", name);
		const inspected = JSON.parse(await docker("inspect", name))[0];
		containerIds.add(inspected.Id);
		const port = Number(
			inspected.NetworkSettings.Ports["6379/tcp"][0].HostPort,
		);
		const timeoutMs = Math.min(2000, remainingMs());
		client = new Redis({
			host: "127.0.0.1",
			port,
			connectTimeout: timeoutMs,
			commandTimeout: timeoutMs,
			disconnectTimeout: Math.max(1, Math.min(100, Math.floor(cleanupMs))),
			// PING is the owned fixture's readiness check; avoid a separate INFO poll.
			enableReadyCheck: false,
			maxRetriesPerRequest: 0,
			retryStrategy: () => {
				if (operationSignal.aborted) return null;
				const remaining = Math.floor(deadline - performance.now());
				return remaining > 0 ? Math.min(50, remaining) : null;
			},
		});
		client.on("error", () => {});
		const timer = setTimeout(() => client.disconnect(), remainingMs());
		const abortReadiness = () => client.disconnect();
		operationSignal.addEventListener("abort", abortReadiness, { once: true });
		try {
			while (true) {
				remainingMs();
				try {
					await client.ping();
					remainingMs();
					break;
				} catch {
					await delay(Math.min(50, remainingMs()), undefined, {
						signal: operationSignal,
					});
				}
			}
		} finally {
			clearTimeout(timer);
			operationSignal.removeEventListener("abort", abortReadiness);
		}
		return port;
	};
	const abort = new AbortController();
	const close = async () => {
		closing = true;
		lifetime.abort();
		const start = performance.now();
		server?.closeAllConnections();
		if (server?.listening)
			await new Promise((resolve) => server.close(resolve));
		client?.disconnect();
		await Promise.all([...activeCommands]);
		try {
			await docker("rm", "--force", "--volumes", name);
		} catch (error) {
			if (!error.stderr?.includes("No such container")) throw error;
		}
		timings.teardownSeconds = (performance.now() - start) / 1000;
	};
	try {
		try {
			await docker("image", "inspect", image);
		} catch (error) {
			if (!error.stderr?.includes("No such image")) throw error;
			// Image acquisition cannot leave a late-created container after abort.
			await docker("pull", image);
		}
		const port = await create();
		server = createServer(async (request, response) => {
			if (closing) {
				response.writeHead(503).end("Owned mutation fixture is closing");
				return;
			}
			if (request.method !== "POST" || request.url !== "/reset") {
				response.writeHead(404).end();
				return;
			}
			const start = performance.now();
			try {
				if (failure) throw failure;
				if (process.env.MUTATION_REDIS_RESET_FAILURE === "1")
					throw new Error("Requested reset-failure diagnostic");
				const clients = (await client.client("LIST")).trim().split("\n");
				if (clients.length !== 1)
					throw new Error(
						`Previous mutation leaked ${clients.length - 1} Redis clients`,
					);
				if (isolated) {
					client.disconnect();
					await docker("rm", "--force", "--volumes", name);
					await create(String(port));
				} else await client.flushall("SYNC");
				if ((await client.dbsize()) !== 0)
					throw new Error("Redis reset left mutable data");
				timings.resets++;
				timings.resetSeconds += (performance.now() - start) / 1000;
				response.writeHead(200).end();
			} catch (error) {
				failure = error;
				response.writeHead(503).end("Owned mutation fixture reset failed");
				// Stop execution outside the instrumented test process. A setup failure
				// cannot become a false mutation kill in the native runner.
				abort.abort();
			}
		});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		timings.startupSeconds = (performance.now() - start) / 1000;
		return {
			name,
			image,
			timings,
			get containerIds() {
				return [...containerIds];
			},
			failureSignal: abort.signal,
			get failure() {
				return failure;
			},
			close,
			env: {
				WALLPAPERDB_MUTATION_REDIS_PORT: String(port),
				WALLPAPERDB_MUTATION_RESET: `http://127.0.0.1:${server.address().port}/reset`,
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

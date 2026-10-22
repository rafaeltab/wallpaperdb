import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

/** Physical Redis belongs to this stage, not Vitest's repeated module lifetime. */
export async function redisFixture(
	cwd,
	image,
	deadline = performance.now() + 30_000,
	cleanupMs = 5000,
) {
	if (!/^redis(?::[a-zA-Z0-9_.-]+)?@sha256:[a-f0-9]{64}$/.test(image))
		throw new Error("Mutation Redis requires an immutable fixtureImage digest");
	const name = `wallpaperdb-mutation-${randomUUID()}`;
	let closing = false;
	const remainingMs = () => {
		const remaining = Math.floor(deadline - performance.now());
		if (remaining <= 0)
			throw new Error("Mutation Redis stage deadline expired");
		return remaining;
	};
	const docker = (...args) =>
		execFileSync("docker", args, {
			encoding: "utf8",
			timeout: closing
				? Math.max(1, Math.floor(cleanupMs))
				: args[0] === "create"
					? remainingMs()
					: Math.min(10_000, remainingMs()),
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
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
		docker(
			"create",
			"--pull=missing",
			"--name",
			name,
			"--label",
			`wallpaperdb.mutation=${name}`,
			"--publish",
			`127.0.0.1:${fixedPort}:6379`,
			image,
		);
		docker("start", name);
		const inspected = JSON.parse(docker("inspect", name))[0];
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
				const remaining = Math.floor(deadline - performance.now());
				return remaining > 0 ? Math.min(50, remaining) : null;
			},
		});
		client.on("error", () => {});
		const timer = setTimeout(() => client.disconnect(), remainingMs());
		try {
			await client.ping();
			remainingMs();
		} finally {
			clearTimeout(timer);
		}
		return port;
	};
	const abort = new AbortController();
	const close = async () => {
		closing = true;
		const start = performance.now();
		server?.closeAllConnections();
		if (server?.listening)
			await new Promise((resolve) => server.close(resolve));
		client?.disconnect();
		try {
			docker("rm", "--force", "--volumes", name);
		} catch (error) {
			if (!error.stderr?.includes("No such container")) throw error;
		}
		timings.teardownSeconds = (performance.now() - start) / 1000;
	};
	try {
		const port = await create();
		server = createServer(async (request, response) => {
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
					docker("rm", "--force", "--volumes", name);
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
		await close();
		throw error;
	}
}

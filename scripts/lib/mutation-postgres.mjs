import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { FixtureCleanupError } from "./mutation-fixture.mjs";

const execute = promisify(execFile);

/** One serial profile-store owner. No developer database or Testcontainers reaper. */
export async function postgresFixture(cwd, image, deadline, cleanupMs, signal) {
	if (!/^postgres(?::[a-zA-Z0-9_.-]+)?@sha256:[a-f0-9]{64}$/.test(image))
		throw new Error(
			"Mutation PostgreSQL requires an immutable fixtureImage digest",
		);
	const name = `wallpaperdb-mutation-${randomUUID()}`;
	const adminPassword = randomUUID();
	const applicationPassword = randomUUID();
	const token = randomUUID();
	const lifetime = new AbortController();
	const operation = signal
		? AbortSignal.any([signal, lifetime.signal])
		: lifetime.signal;
	const abort = new AbortController();
	const commands = new Set();
	const clients = new Set();
	const ids = new Set();
	const postgres = createRequire(join(cwd, "package.json"))("postgres");
	const migrations = readdirSync(join(cwd, "drizzle"))
		.filter((name) => name.endsWith(".sql"))
		.sort()
		.map((name) => readFileSync(join(cwd, "drizzle", name), "utf8"));
	const timings = {
		startupSeconds: 0,
		resets: 0,
		resetSeconds: 0,
		initializationSeconds: 0,
		teardownSeconds: 0,
	};
	let closing = false,
		failure,
		server,
		admin,
		port,
		resetting = false;
	let closePromise, resetAbort, resetDone, cleanupDeadline;
	const remaining = () => {
		operation.throwIfAborted();
		resetAbort?.signal.throwIfAborted();
		const ms = Math.floor(deadline - performance.now());
		if (ms <= 0) throw new Error("Mutation PostgreSQL stage deadline expired");
		return ms;
	};
	const docker = async (...args) => {
		const cleanup = closing;
		if (cleanup && args[0] !== "rm")
			throw new Error("Owned fixture is closing");
		const request = execute("docker", args, {
			encoding: "utf8",
			timeout: cleanup
				? Math.max(1, Math.floor(cleanupDeadline - performance.now()))
				: Math.min(args[0] === "pull" ? Infinity : 10_000, remaining()),
			signal: cleanup
				? undefined
				: resetAbort
					? AbortSignal.any([operation, resetAbort.signal])
					: operation,
			killSignal: "SIGKILL",
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
	const connect = (database, user = "postgres") => {
		remaining();
		const sql = postgres({
			host: "127.0.0.1",
			port,
			database,
			username: user,
			password: user === "postgres" ? adminPassword : applicationPassword,
			max: 1,
			connect_timeout: 2,
			connection: {
				statement_timeout: 5000,
				lock_timeout: 1000,
				application_name: "mutation-controller",
			},
			onnotice: () => {},
		});
		clients.add(sql);
		return sql;
	};
	const disconnect = async (sql) => {
		await sql.end({ timeout: 0 });
		clients.delete(sql);
	};
	const disconnectAll = () => Promise.all([...clients].map(disconnect));
	const verifyNoClients = async (boundary) => {
		const [active] =
			await admin`select count(*)::int as count from pg_stat_activity where datname = 'mutation'`;
		if (active.count)
			throw new Error(`${boundary} leaked ${active.count} PostgreSQL clients`);
	};
	const interrupted = () => {
		void disconnectAll().catch((error) => {
			failure ??= error;
			abort.abort();
		});
	};
	operation.addEventListener("abort", interrupted, { once: true });
	const create = async (fixedPort = "") => {
		const start = performance.now();
		await docker(
			"create",
			"--pull=never",
			"--name",
			name,
			"--label",
			`wallpaperdb.mutation=${name}`,
			"--publish",
			`127.0.0.1:${fixedPort}:5432`,
			"--env",
			`POSTGRES_PASSWORD=${adminPassword}`,
			image,
		);
		await docker("start", name);
		const inspected = JSON.parse(await docker("inspect", name))[0];
		ids.add(inspected.Id);
		port = Number(inspected.NetworkSettings.Ports["5432/tcp"][0].HostPort);
		// Check the published TCP endpoint, including PostgreSQL's final restart.
		while (true) {
			remaining();
			const probe = connect("postgres");
			try {
				await probe`select 1`;
				break;
			} catch {
				await delay(Math.min(50, remaining()), undefined, {
					signal: operation,
				});
			} finally {
				await disconnect(probe);
			}
		}
		admin = connect("postgres");
		await admin.unsafe(
			`create role mutation login password '${applicationPassword}' nosuperuser nocreatedb nocreaterole`,
		);
		timings.startupSeconds += (performance.now() - start) / 1000;
	};
	const close = () => {
		closePromise ??= (async () => {
			const start = performance.now();
			cleanupDeadline = performance.now() + cleanupMs;
			const timer = setTimeout(
				() => {
					lifetime.abort();
					void disconnectAll();
				},
				Math.max(1, cleanupMs - Math.min(1000, cleanupMs / 3)),
			);
			let disposalError;
			// The worker has stopped, but its last reset can still be finishing.
			// Drain it before aborting its owned operations; the cleanup timer and
			// independent reset deadline still bound this wait and preserve faults.
			try {
				await resetDone;
			} catch (error) {
				disposalError = error;
			}
			// The last mutant has no next reset to detect leaked clients for it.
			if (admin && !resetting && !failure && !operation.aborted) {
				try {
					await verifyNoClients("Final mutation");
				} catch (error) {
					disposalError = error;
				}
			}
			closing = true;
			lifetime.abort();
			try {
				server?.closeAllConnections();
				if (server?.listening)
					await new Promise((resolve) => server.close(resolve));
				await disconnectAll();
				await Promise.all([...commands]);
				await resetDone;
			} catch (error) {
				disposalError ??= error;
			} finally {
				try {
					await docker("rm", "--force", "--volumes", name);
				} catch (error) {
					if (!error.stderr?.includes("No such container"))
						disposalError ??= error;
				} finally {
					clearTimeout(timer);
					operation.removeEventListener("abort", interrupted);
					timings.teardownSeconds = (performance.now() - start) / 1000;
				}
			}
			if (disposalError) throw disposalError;
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
				request.method === "POST" &&
				request.url === "/disposed" &&
				request.headers.authorization === `Bearer ${token}`
			) {
				if (closing || failure || resetting) {
					failure ??= new Error("Owned fixture unavailable during disposal");
					abort.abort();
					response.writeHead(503).end();
					return;
				}
				resetDone = (async () => {
					try {
						if (closing || failure || resetting)
							throw (
								failure ??
								new Error("Owned fixture unavailable during disposal")
							);
						resetting = true;
						await verifyNoClients("Mutation disposal");
						response.writeHead(200).end();
					} catch (error) {
						failure ??= error;
						abort.abort();
						response.writeHead(503).end();
					} finally {
						resetting = false;
					}
				})();
				return;
			}
			if (
				request.method === "POST" &&
				request.url === "/failure" &&
				request.headers.authorization === `Bearer ${token}`
			) {
				failure ??= new Error(
					"Mutation PostgreSQL application disposal failed",
				);
				abort.abort();
				response.writeHead(503).end();
				return;
			}
			if (
				request.method !== "POST" ||
				request.url !== "/reset" ||
				request.headers.authorization !== `Bearer ${token}`
			) {
				response.writeHead(404).end();
				return;
			}
			if (resetting || closing) {
				failure ??= new Error("Owned fixture unavailable or concurrent reset");
				abort.abort();
				response.writeHead(503).end();
				return;
			}
			resetDone = (async () => {
				const start = performance.now();
				let timer;
				try {
					if (closing || failure || resetting)
						throw (
							failure ??
							new Error("Owned fixture unavailable or concurrent reset")
						);
					resetting = true;
					resetAbort = new AbortController();
					// Destroy underlying connections at the reset deadline, not just the HTTP wait.
					timer = setTimeout(
						() => {
							failure ??= new Error("Owned PostgreSQL reset deadline expired");
							resetAbort.abort();
							abort.abort();
							void disconnectAll();
						},
						Math.min(5000, remaining()),
					);
					if (process.env.MUTATION_POSTGRES_RESET_FAILURE === "1")
						throw new Error("Requested PostgreSQL reset-failure diagnostic");
					await verifyNoClients("Previous mutation");
					if (process.env.MUTATION_POSTGRES_ISOLATED === "1") {
						await disconnect(admin);
						await docker("rm", "--force", "--volumes", name);
						await create(String(port));
					}
					// Separate commands: DROP/CREATE DATABASE cannot run in a transaction.
					await admin.unsafe("drop database if exists mutation");
					await admin.unsafe(
						"create database mutation owner mutation template template0",
					);
					await admin.unsafe("revoke connect on database mutation from public");
					const initializationStart = performance.now();
					const sql = connect("mutation", "mutation");
					try {
						for (const migration of migrations) await sql.unsafe(migration);
					} finally {
						await disconnect(sql);
					}
					timings.initializationSeconds +=
						(performance.now() - initializationStart) / 1000;
					remaining();
					if (failure) throw failure;
					timings.resets++;
					timings.resetSeconds += (performance.now() - start) / 1000;
					response.writeHead(200).end();
				} catch (error) {
					failure ??= error;
					response.writeHead(503).end("Owned PostgreSQL reset failed");
					abort.abort();
				} finally {
					clearTimeout(timer);
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
			timings,
			close,
			get containerIds() {
				return [...ids];
			},
			get failure() {
				return failure;
			},
			failureSignal: abort.signal,
			env: {
				WALLPAPERDB_MUTATION_POSTGRES_URL: `postgresql://mutation:${applicationPassword}@127.0.0.1:${port}/mutation`,
				WALLPAPERDB_MUTATION_POSTGRES_RESET: `http://127.0.0.1:${server.address().port}/reset`,
				WALLPAPERDB_MUTATION_POSTGRES_TOKEN: token,
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

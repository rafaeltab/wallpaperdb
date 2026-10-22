import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	appendFileSync,
	existsSync,
	lstatSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { constants, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseEnv } from "node:util";
import { acquireDockerLease, defaultDockerLock } from "./lib/docker-queue.mjs";

const [turbo, ...arguments_] = process.argv.slice(2);
const separator = arguments_.indexOf("--");
const flags = separator < 0 ? arguments_ : arguments_.slice(0, separator);
const testArguments = separator < 0 ? [] : arguments_.slice(separator + 1);
const executionFlags = flags.filter((flag) => !flag.startsWith("--filter="));
const abort = new AbortController();
const secrets = new Set();
const browserOnlyKeys = [
	"CLERK_SECRET_KEY",
	"E2E_BASE_TEST_EMAIL",
	"E2E_BASE_TEST_PASSWORD",
	"E2E_ARTIFACTS_DIR",
];
let interrupted;
let activeChild;
let diagnostics;
let diagnosticsFailure;
let lockDescriptor;
let dockerLease;
let outputFailure;
const failedOutputs = new Set();
let phase = "selection";
let owned = false;
let project;
let environment = orchestrationEnvironment(process.env);
let browserEnvironment = {};
rememberSecrets(process.env);
let cleanupRunning = false;
let rerunPackage =
	flags
		.find((flag) => /^--filter=@wallpaperdb\/[a-z0-9-]+$/.test(flag))
		?.split("/")
		.at(-1) ?? "web-e2e";

function orchestrationEnvironment(values) {
	const result = { ...values };
	for (const key of browserOnlyKeys) delete result[key];
	return result;
}

for (const stream of [process.stdout, process.stderr]) {
	stream.on("error", (cause) => failOutput(stream, cause));
}

function failOutput(stream, cause) {
	failedOutputs.add(stream);
	if (outputFailure) return;
	outputFailure = Object.assign(
		new Error(`Console output failed (${cause.code ?? "unknown error"}).`),
		{
			status: interrupted ?? 1,
			phase: cleanupRunning ? "browser cleanup" : phase,
		},
	);
	process.exitCode ??= outputFailure.status;
	if (!cleanupRunning) {
		abort.abort();
		stopChild();
	}
	record(outputFailure.message, true);
}

function writeConsole(message, error) {
	const stream = error ? process.stderr : process.stdout;
	if (failedOutputs.has(stream)) return;
	try {
		stream.write(`${message}\n`);
	} catch (cause) {
		failOutput(stream, cause);
	}
}

for (const [signal, status] of [
	["SIGHUP", 129],
	["SIGINT", 130],
	["SIGTERM", 143],
]) {
	process.on(signal, () => {
		interrupted = status;
		process.exitCode = status;
		if (cleanupRunning) return;
		abort.abort();
		stopChild();
	});
}

function stopChild() {
	if (!activeChild) return;
	const child = activeChild;
	if (child.stopping) return;
	try {
		process.kill(-child.pid, "SIGTERM");
	} catch {
		/* Already exited. */
	}
	child.stopping = new Promise((resolve) => {
		const killer = setTimeout(() => {
			try {
				process.kill(-child.pid, "SIGKILL");
			} catch {}
			resolve();
		}, 5000);
		child.once("close", () => {
			try {
				process.kill(-child.pid, 0);
			} catch (error) {
				if (error.code === "ESRCH") {
					clearTimeout(killer);
					resolve();
				}
			}
		});
	});
}

function redact(value) {
	let result = String(value);
	for (const secret of [...secrets].sort((a, b) => b.length - a.length))
		result = result.split(secret).join("[REDACTED]");
	return result
		.replace(/\b(?:sk|pk)_(?:test|live)_[\w-]+/g, "[REDACTED]")
		.replace(/(Bearer\s+)\S+/gi, "$1[REDACTED]")
		.replace(/(\w+:\/\/)[^\s/@]+:[^\s/@]+@/g, "$1[REDACTED]@");
}

function rememberSecrets(values) {
	for (const [key, value] of Object.entries(values)) {
		if (
			/SECRET|PASSWORD|TOKEN|KEY|EMAIL/.test(key) &&
			value &&
			String(value).length >= 4
		)
			secrets.add(String(value));
	}
}

function record(message, error = false) {
	const safe = redact(message);
	if (diagnostics && !diagnosticsFailure) {
		try {
			appendFileSync(join(diagnostics, "run.log"), `${safe}\n`);
		} catch (cause) {
			diagnosticsFailure = Object.assign(
				new Error(
					`run.log write failed (${cause.code ?? "unknown error"}); retained diagnostics may be incomplete. Further output is console-only.`,
				),
				{
					status: interrupted ?? 1,
					phase: cleanupRunning ? "browser cleanup" : phase,
				},
			);
			writeConsole(redact(diagnosticsFailure.message), true);
		}
	}
	writeConsole(safe, error);
}

function seconds(key, fallback) {
	const value = Number(process.env[key] ?? fallback);
	if (!Number.isFinite(value) || value <= 0)
		throw new Error(`${key} must be a positive number of seconds.`);
	return value * 1000;
}

async function run(
	command,
	args,
	{ capture = false, timeout = 1_200_000, env = environment } = {},
) {
	if (interrupted && !cleanupRunning)
		throw Object.assign(new Error("Interrupted."), { status: interrupted });
	if (diagnosticsFailure && !cleanupRunning) throw diagnosticsFailure;
	if (outputFailure && !cleanupRunning) throw outputFailure;
	return await new Promise((resolveResult, reject) => {
		const child = spawn(command, args, {
			env:
				lockDescriptor === undefined
					? env
					: {
							...env,
							WALLPAPERDB_DOCKER_LEASE_FD: "9",
							WALLPAPERDB_DOCKER_LEASE_FILE: dockerLease.file,
						},
			detached: true,
			stdio:
				lockDescriptor !== undefined
					? [
							"ignore",
							"pipe",
							"pipe",
							...Array(6).fill("ignore"),
							lockDescriptor,
						]
					: ["ignore", "pipe", "pipe"],
		});
		activeChild = child;
		let stdout = "";
		let stderr = "";
		let capturedBytes = 0;
		let captureFailure;

		const outputs = [
			{ stream: child.stdout, pending: "", omitted: false, error: false },
			{ stream: child.stderr, pending: "", omitted: false, error: true },
		];
		let timedOut = false;
		let stoppingForDiagnostics = false;
		for (const output of outputs) {
			output.stream.setEncoding("utf8");
			output.stream.on("data", (data) => {
				if (capture) {
					if (captureFailure) return;
					capturedBytes += Buffer.byteLength(data);
					if (capturedBytes > 1_048_576) {
						captureFailure = Object.assign(
							new Error(
								`Capture exceeded 1048576 bytes; stopped ${command} without retaining incomplete output.`,
							),
							{
								status: interrupted ?? 1,
								phase: cleanupRunning ? "browser cleanup" : phase,
							},
						);
						stdout = "";
						stderr = "";
						stopChild();
						return;
					}
					if (output.error) stderr += data;
					else stdout += data;
					return;
				}
				const parts = data.split(/\r\n|[\r\n]/);
				for (const [index, part] of parts.entries()) {
					if (!output.omitted) {
						output.pending += part;
						if (output.pending.length > 65_536) {
							// Omit the entire oversized line, including secrets at its boundary.
							output.pending = "";
							output.omitted = true;
							record(
								"Omitted output line longer than 65536 characters.",
								output.error,
							);
						}
					}
					if (index < parts.length - 1) {
						if (!output.omitted) record(output.pending, output.error);
						output.pending = "";
						output.omitted = false;
					}
				}
				if (diagnosticsFailure && !cleanupRunning && !stoppingForDiagnostics) {
					stoppingForDiagnostics = true;
					stopChild();
				}
			});
		}
		const timer = setTimeout(
			() => {
				timedOut = true;
				stopChild();
			},
			Math.max(1, timeout),
		);
		child.on("error", async (error) => {
			clearTimeout(timer);
			await child.stopping;
			activeChild = undefined;
			reject(error);
		});
		child.on("close", async (code, signal) => {
			clearTimeout(timer);
			await child.stopping;
			activeChild = undefined;
			if (captureFailure) {
				reject(captureFailure);
				return;
			}
			const priorDiagnosticsFailure = diagnosticsFailure ?? outputFailure;
			for (const output of outputs)
				if (output.pending && !capture) record(output.pending, output.error);
			if (priorDiagnosticsFailure && !cleanupRunning) {
				reject(priorDiagnosticsFailure);
				return;
			}
			if (code !== 0 || timedOut || (interrupted && !cleanupRunning)) {
				const status =
					!cleanupRunning && interrupted
						? interrupted
						: timedOut
							? 124
							: (code ??
								(constants.signals[signal]
									? 128 + constants.signals[signal]
									: 1));
				reject(
					Object.assign(
						new Error(
							`${command} failed (exit ${status})${timedOut ? ": deadline exceeded" : ""}. ${capture ? redact(stderr) : "See run.log."}`,
						),
						{ status },
					),
				);
			} else if ((diagnosticsFailure || outputFailure) && !cleanupRunning)
				reject(diagnosticsFailure ?? outputFailure);
			else resolveResult(stdout);
		});
	});
}

function compose(file, ...args) {
	return [
		"compose",
		"-p",
		project,
		"-f",
		`infra/docker-compose${file === "apps" ? ".apps" : ""}.yml`,
		...args,
	];
}

async function availablePort(key, value) {
	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65535)
		throw new Error(`Invalid ${key}; rerun make install.`);
	await new Promise((done, reject) => {
		const server = createServer();
		server.once("error", (error) =>
			reject(
				new Error(
					`${key}=${port} is unavailable (${error.code}). Preserve the existing stack; use a free worktree slot or stop your development stack deliberately.`,
				),
			),
		);
		server.listen({ port, host: "0.0.0.0", exclusive: true }, () =>
			server.close(done),
		);
	});
}

function readEnv(path) {
	if (!existsSync(path))
		throw new Error(`Missing ${path}. Configure secrets and run make install.`);
	const values = parseEnv(readFileSync(path, "utf8"));
	rememberSecrets(values);
	return values;
}

async function preflightBrowser() {
	phase = "browser preflight";
	const worktree = readEnv(".worktree");
	if (!worktree.COMPOSE_PROJECT_NAME)
		throw new Error("Missing worktree Compose project; run make install.");
	project = `${worktree.COMPOSE_PROJECT_NAME.slice(0, 42)}-e2e-${randomUUID().slice(0, 8)}`;
	environment = orchestrationEnvironment({
		...process.env,
		...worktree,
		COMPOSE_PROJECT_NAME: project,
		COMPOSE_PROFILES: "",
	});
	const portKeys = [
		"INGRESS_PORT",
		"POSTGRES_HOST_PORT",
		"S3_API_HOST_PORT",
		"NATS_HOST_PORT",
		"REDIS_HOST_PORT",
		"OPENSEARCH_HOST_PORT",
		"OTEL_HTTP_HOST_PORT",
		"OTEL_GRPC_HOST_PORT",
	];
	if (new Set(portKeys.map((key) => worktree[key])).size !== portKeys.length)
		throw new Error("Worktree ports must be distinct. Rerun make install.");
	for (const key of portKeys) await availablePort(key, worktree[key]);
	const browser = { ...readEnv("apps/web-e2e/.env"), ...process.env };
	const baseUrl = `http://localhost:${worktree.INGRESS_PORT}/web`;
	if (browser.PLAYWRIGHT_BASE_URL && browser.PLAYWRIGHT_BASE_URL !== baseUrl)
		throw new Error(
			"PLAYWRIGHT_BASE_URL must match this worktree ingress for an owned local run. Rerun make install without an external URL override.",
		);
	for (const key of ["E2E_BASE_TEST_EMAIL", "E2E_BASE_TEST_PASSWORD"]) {
		if (!browser[key]?.trim())
			throw new Error(
				`Missing ${key}. Configure secrets and run make install.`,
			);
	}
	const require = createRequire(resolve("apps/web-e2e/package.json"));
	const { chromium } = require("@playwright/test");
	if (!existsSync(chromium.executablePath()))
		throw new Error(
			"Chromium is missing. Run make run PACKAGE=web-e2e SCRIPT=test:browser:install.",
		);
	browserEnvironment = {
		E2E_BASE_TEST_EMAIL: browser.E2E_BASE_TEST_EMAIL,
		E2E_BASE_TEST_PASSWORD: browser.E2E_BASE_TEST_PASSWORD,
	};
	environment.PLAYWRIGHT_BASE_URL = baseUrl;
	rememberSecrets(browserEnvironment);
	await run("docker", ["compose", "version"], { capture: true });
	await run("docker", ["buildx", "version"], { capture: true });
	// Compose can include values in parse errors. Load generated secrets before invoking it.
	for (const service of [
		"ingestor",
		"asset",
		"gateway",
		"user",
		"web",
		"tags",
		"wallpaper",
		"variant-generator",
		"color-extractor",
	]) {
		const path = `apps/${service}/.env`;
		if (existsSync(path)) rememberSecrets(readEnv(path));
	}
	await run("docker", compose("infra", "config", "--format", "json"), {
		capture: true,
	});
	const config = JSON.parse(
		await run("docker", compose("apps", "config", "--format", "json"), {
			capture: true,
		}),
	);
	for (const service of Object.values(config.services))
		rememberSecrets(service.environment ?? {});
	const requirements = {
		ingestor: ["CLERK_SECRET_KEY", "CLERK_PUBLISHABLE_KEY", "CLERK_DOMAIN"],
		user: [
			"CLERK_SECRET_KEY",
			"CLERK_PUBLISHABLE_KEY",
			"USER_MEDIA_SERVICE_TOKEN",
		],
		asset: ["USER_MEDIA_SERVICE_TOKEN"],
		gateway: ["CURSOR_SECRET"],
		web: ["VITE_CLERK_PUBLISHABLE_KEY"],
	};
	for (const [service, keys] of Object.entries(requirements)) {
		for (const key of keys) {
			const value = config.services[service]?.environment?.[key];
			if (!value?.trim() || /replace|your-clerk/i.test(value))
				throw new Error(
					`Missing or placeholder ${key} for ${service}. Configure secrets and run make install.`,
				);
			if (key === "CLERK_SECRET_KEY" && !value.startsWith("sk_test_"))
				throw new Error(
					`${service} requires a Clerk development sk_test_ key for browser E2E.`,
				);
			if (
				key.endsWith("CLERK_PUBLISHABLE_KEY") &&
				!value.startsWith("pk_test_")
			)
				throw new Error(
					`${service} requires a Clerk development pk_test_ publishable key for browser E2E.`,
				);
		}
	}
	const publishableKeys = [
		config.services.ingestor.environment.CLERK_PUBLISHABLE_KEY,
		config.services.user.environment.CLERK_PUBLISHABLE_KEY,
		config.services.web.environment.VITE_CLERK_PUBLISHABLE_KEY,
	];
	if (new Set(publishableKeys).size !== 1)
		throw new Error(
			"Clerk publishable keys must match across Ingestor, User, and Web. Configure one development instance and run make install.",
		);
	if (
		config.services.user.environment.USER_MEDIA_SERVICE_TOKEN !==
		config.services.asset.environment.USER_MEDIA_SERVICE_TOKEN
	)
		throw new Error(
			"User and Asset USER_MEDIA_SERVICE_TOKEN values must match. Rerun make install.",
		);
	browserEnvironment.CLERK_SECRET_KEY =
		config.services.user.environment.CLERK_SECRET_KEY;
	const init = resolve("infra/postgres/init");
	if (
		lstatSync(init).isSymbolicLink() ||
		(lstatSync(init).mode & 0o005) !== 0o005
	)
		throw new Error(
			"PostgreSQL initialization directory is not container-accessible. Run chmod a+rx infra/postgres/init and chmod a+r infra/postgres/init/*.sql. Only public initialization files need these permissions.",
		);
	for (const entry of readdirSync(init)) {
		const stat = lstatSync(join(init, entry));
		if (!stat.isFile() || stat.isSymbolicLink() || !(stat.mode & 0o004))
			throw new Error(
				`PostgreSQL initialization file infra/postgres/init/${entry} is not a public readable file. Run chmod a+r infra/postgres/init/*.sql; keep the directory searchable with chmod a+rx infra/postgres/init.`,
			);
	}
	for (const args of [
		["ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`],
		[
			"volume",
			"ls",
			"-q",
			"--filter",
			`label=com.docker.compose.project=${project}`,
		],
		[
			"network",
			"ls",
			"-q",
			"--filter",
			`label=com.docker.compose.project=${project}`,
		],
	]) {
		if ((await run("docker", args, { capture: true })).trim())
			throw new Error(
				`Refusing existing resources for ${project}. Retry for a new isolated project.`,
			);
	}
	owned = true;
	record(
		`Owned browser project: ${project}. Development projects and volumes are preserved.`,
	);
	try {
		await run(
			"docker",
			[
				"run",
				"--rm",
				"--name",
				`${project}-init-check`,
				"--label",
				`com.docker.compose.project=${project}`,
				"--user",
				"postgres",
				"--mount",
				`type=bind,src=${init},dst=/init,readonly`,
				"postgres:16-alpine",
				"sh",
				"-ec",
				'test -r /init && test -x /init; for file in /init/*; do test -r "$file" || exit 1; done',
			],
			{ timeout: 60_000 },
		);
	} catch (error) {
		throw Object.assign(
			new Error(
				`PostgreSQL initialization mount probe failed. Verify Docker bind-mount access, parent traversal, SELinux/AppArmor, or remote daemon paths. Public-file chmod cannot resolve host mount restrictions. ${error.message}`,
			),
			{ status: error.status },
		);
	}
}

async function waitForBrowser(deadline) {
	const { verifyWebE2EEnvironment } = await import(
		"../apps/web-e2e/src/environment-contract.ts"
	);
	let failure;
	record(
		"Waiting for browser readiness using the browser environment contract.",
	);
	do {
		try {
			await verifyWebE2EEnvironment(environment, (url, options) =>
				fetch(url, {
					...options,
					signal: AbortSignal.any([
						abort.signal,
						AbortSignal.timeout(
							Math.max(1, Math.min(5000, deadline - Date.now())),
						),
					]),
				}),
			);
			return;
		} catch (error) {
			failure = error;
			if (abort.signal.aborted)
				throw (
					outputFailure ??
					Object.assign(new Error("Interrupted during readiness."), {
						status: interrupted,
					})
				);
		}
		if (Date.now() < deadline)
			await delay(Math.min(1000, deadline - Date.now()), undefined, {
				signal: abort.signal,
			});
	} while (Date.now() < deadline);
	throw Object.assign(
		new Error(`Browser readiness deadline exceeded.\n${failure.message}`),
		{ status: 124 },
	);
}

async function retainBrowserDiagnostics() {
	let failure;
	if (
		(phase === "application startup" || phase === "infrastructure startup") &&
		!interrupted
	) {
		try {
			const { verifyWebE2EEnvironment } = await import(
				"../apps/web-e2e/src/environment-contract.ts"
			);
			await verifyWebE2EEnvironment(environment, (url, options) =>
				fetch(url, { ...options, signal: AbortSignal.timeout(3000) }),
			);
		} catch (error) {
			record(error.message, true);
		}
	}
	for (const file of ["apps", "infra"]) {
		try {
			const output = await run(
				"docker",
				compose(file, "logs", "--no-color", "--tail", "200"),
				{ capture: true, timeout: 15_000 },
			);
			writeFileSync(join(diagnostics, `${file}.log`), redact(output));
		} catch (error) {
			record(`Diagnostic capture failed: ${error.message}`, true);
			failure ??= error;
		}
	}
	if (failure) throw failure;
}

async function cleanup() {
	if (!owned) return;
	cleanupRunning = true;
	let failure;
	try {
		await retainBrowserDiagnostics();
	} catch (error) {
		record(`Artifact retention failed: ${error.message}`, true);
		failure = error;
	}
	for (const file of ["apps", "infra"]) {
		try {
			await run(
				"docker",
				compose(
					file,
					"down",
					"--volumes",
					"--remove-orphans",
					...(file === "apps" ? ["--rmi", "local"] : []),
				),
				{ timeout: 60_000 },
			);
		} catch (error) {
			record(
				`Cleanup failed for ${file}, exit ${error.status ?? 1}: ${error.message}`,
				true,
			);
			failure ??= error;
		}
	}
	try {
		const probe = await run(
			"docker",
			["ps", "-aq", "--filter", `name=^${project}-init-check$`],
			{ capture: true, timeout: 15_000 },
		);
		if (probe.trim())
			await run("docker", ["rm", "-f", `${project}-init-check`], {
				timeout: 15_000,
			});
	} catch (error) {
		record(`Initialization probe cleanup failed: ${error.message}`, true);
		failure ??= error;
	}
	owned = false;
	cleanupRunning = false;
	if (failure) {
		record(
			`Retained project ${project} may need manual cleanup. Inspect diagnostics before running docker compose -p ${project} -f infra/docker-compose.apps.yml down --volumes --rmi local and docker compose -p ${project} -f infra/docker-compose.yml down --volumes.`,
			true,
		);
		throw failure;
	}
}

async function runSuites(packages, env = environment) {
	await run(
		turbo,
		[
			"run",
			"test:e2e",
			...executionFlags,
			...packages.map((name) => `--filter=${name}`),
			"--concurrency=1",
			...(testArguments.length ? ["--", ...testArguments] : []),
		],
		{ env },
	);
}

async function acquireDockerLock() {
	phase = "Docker host lock";
	dockerLease = await acquireDockerLease({
		file:
			process.env.DOCKER_VALIDATION_LOCK_FILE ||
			process.env.E2E_LOCK_FILE ||
			defaultDockerLock,
		timeoutSeconds:
			process.env.DOCKER_VALIDATION_TIMEOUT ??
			process.env.E2E_LOCK_TIMEOUT ??
			"900",
		label: "local E2E",
		signal: abort.signal,
		report: record,
	});
	lockDescriptor = dockerLease.descriptor;
}

async function main() {
	if (flags.some((flag) => flag.startsWith("--dry"))) {
		process.stdout.write(
			await run(turbo, ["run", "test:e2e", ...flags, "--concurrency=1"], {
				capture: true,
			}),
		);
		return;
	}
	await acquireDockerLock();
	phase = "selection";
	diagnostics = mkdtempSync(resolve(tmpdir(), "wallpaperdb-e2e-"));
	record(
		`E2E diagnostics retained at ${diagnostics}. Keep browser artifacts private; sanitize excerpts before publication.`,
	);
	const plan = JSON.parse(
		await run(
			turbo,
			["run", "test:e2e", ...flags, "--concurrency=1", "--dry=json"],
			{ capture: true },
		),
	);
	const selected = [
		...new Set(
			plan.tasks
				.filter(
					(task) =>
						task.task === "test:e2e" && task.command !== "<NONEXISTENT>",
				)
				.map((task) => task.package),
		),
	];
	if (!selected.length)
		throw new Error(
			"No E2E suite selected. Use PACKAGE=web-e2e, PACKAGE=test-utils, PACKAGE=testcontainers, or omit PACKAGE for all.",
		);
	rerunPackage = selected.includes("@wallpaperdb/web-e2e")
		? "web-e2e"
		: selected[0].split("/").at(-1);
	phase = "Docker preflight";
	await run("docker", ["info"], { capture: true, timeout: 15_000 });
	const containers = selected.filter((name) => name !== "@wallpaperdb/web-e2e");
	if (selected.includes("@wallpaperdb/web-e2e")) {
		let failure;
		try {
			phase = "browser preflight";
			const buildTimeout = seconds("E2E_BUILD_TIMEOUT", 1200);
			const readyTimeout = seconds("E2E_READY_TIMEOUT", 240);
			await preflightBrowser();
			phase = "current-checkout image build";
			await run("docker", compose("apps", "build"), {
				timeout: buildTimeout,
			});
			const deadline = Date.now() + readyTimeout;
			phase = "infrastructure startup";
			await run(
				"docker",
				compose(
					"infra",
					"up",
					"-d",
					"--wait",
					"--wait-timeout",
					String(Math.max(1, Math.ceil((deadline - Date.now()) / 1000))),
				),
				{ timeout: deadline - Date.now() },
			);
			phase = "application startup";
			await run("docker", compose("apps", "up", "-d", "--no-build"), {
				timeout: deadline - Date.now(),
			});
			phase = "browser readiness";
			await waitForBrowser(deadline);
			phase = "browser tests";
			await runSuites(["@wallpaperdb/web-e2e"], {
				...environment,
				...browserEnvironment,
				E2E_ARTIFACTS_DIR: diagnostics,
			});
		} catch (error) {
			failure = error;
		}
		try {
			await cleanup();
		} catch (error) {
			if (!failure) {
				phase = "browser cleanup";
				failure = interrupted
					? Object.assign(new Error("Interrupted during cleanup."), {
							status: interrupted,
						})
					: error;
			}
		}
		if (failure) throw failure;
		if (diagnosticsFailure) throw diagnosticsFailure;
		if (outputFailure) throw outputFailure;
		if (interrupted) {
			phase = "browser cleanup";
			throw Object.assign(new Error("Interrupted during cleanup."), {
				status: interrupted,
			});
		}
	}
	if (containers.length) {
		phase = "container tests";
		record("Container E2E: using suite-owned test containers.");
		for (const container of containers) {
			rerunPackage = container.split("/").at(-1);
			await runSuites([container]);
		}
	}
	if (diagnosticsFailure) throw diagnosticsFailure;
	if (outputFailure) throw outputFailure;
	phase = "diagnostics cleanup";
	await rm(diagnostics, { recursive: true });
	diagnostics = undefined;
	if (outputFailure) throw outputFailure;
	if (interrupted)
		throw Object.assign(new Error("Interrupted during diagnostics cleanup."), {
			status: interrupted,
		});
	record(
		"All requested E2E phases and cleanup passed. Temporary diagnostics removed.",
	);
}

try {
	await main();
} catch (error) {
	record(
		`E2E phase "${error.phase ?? phase}" failed, exit ${error.status ?? interrupted ?? 1}: ${error.message}`,
		true,
	);
	record(
		`Diagnostics: ${diagnostics ?? "not created"}. Focused rerun: make test-e2e PACKAGE=${rerunPackage}${testArguments.length ? ` ARGS=${shellQuote(testArguments.map(shellQuote).join(" "))}` : ""}${flags.includes("--force") ? " FORCE=1" : ""}`,
		true,
	);
	process.exitCode = error.status ?? interrupted ?? 1;
} finally {
	if (lockDescriptor !== undefined) {
		try {
			dockerLease.release();
		} catch (error) {
			record(`Docker host lock release failed: ${error.message}`, true);
			process.exitCode ||= 1;
		}
	}
}

function shellQuote(value) {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

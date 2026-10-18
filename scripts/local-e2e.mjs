import { spawn } from "node:child_process";

const [turbo, ...arguments_] = process.argv.slice(2);
const separator = arguments_.indexOf("--");
const flags = separator < 0 ? arguments_ : arguments_.slice(0, separator);
const testArguments = separator < 0 ? [] : arguments_.slice(separator + 1);

async function run(command, args, capture = false) {
	return await new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
		});
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (data) => {
			stdout += data;
		});
		child.stderr?.on("data", (data) => {
			stderr += data;
		});
		child.on("error", reject);
		child.on("close", (code, signal) => {
			if (code !== 0)
				reject(
					Object.assign(
						new Error(`${command} failed (exit ${code ?? signal}). ${stderr}`),
						{ status: code ?? 1 },
					),
				);
			else resolve(stdout);
		});
	});
}

async function main() {
	if (flags.some((flag) => flag.startsWith("--dry"))) {
		await run(turbo, ["run", "test:e2e", ...flags, "--concurrency=1"]);
		return;
	}
	const plan = JSON.parse(
		await run(
			turbo,
			["run", "test:e2e", ...flags, "--concurrency=1", "--dry=json"],
			true,
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
	await run("docker", ["info"], true);
	const executionFlags = flags.filter((flag) => !flag.startsWith("--filter="));
	const containers = selected.filter((name) => name !== "@wallpaperdb/web-e2e");
	if (selected.includes("@wallpaperdb/web-e2e"))
		throw new Error("Browser E2E stack lifecycle is not configured.");
	if (containers.length) {
		console.log("Container E2E: using suite-owned test containers.");
		await run(turbo, [
			"run",
			"test:e2e",
			...executionFlags,
			...containers.map((name) => `--filter=${name}`),
			"--concurrency=1",
			...(testArguments.length ? ["--", ...testArguments] : []),
		]);
	}
}

try {
	await main();
} catch (error) {
	console.error(error.message);
	process.exitCode = error.status ?? 1;
}

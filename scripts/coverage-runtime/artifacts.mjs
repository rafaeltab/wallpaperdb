import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

const sha = (data) => createHash("sha256").update(data).digest("hex");
export function beginAttempt(base, root, details) {
	mkdirSync(base, { recursive: true });
	const directory = mkdtempSync(resolve(base, "attempt-"));
	const version = () => {
		const paths = [
			"package.json",
			"pnpm-lock.yaml",
			"mise.toml",
			...readdirSync(resolve(root, "scripts/coverage-runtime"), {
				recursive: true,
			})
				.filter((p) => /\.(mjs|ts|tsx|patch)$/.test(p))
				.map((p) => "scripts/coverage-runtime/" + p),
		];
		const inputs = Object.fromEntries(
			paths.sort().map((p) => [p, sha(readFileSync(resolve(root, p)))]),
		);
		return { sha256: sha(JSON.stringify(inputs)), inputs };
	};
	const configPaths = [
		details.config,
		details.sourceConfig,
		...readdirSync(dirname(details.sourceConfig))
			.filter((f) => /vitest.*config/.test(f))
			.map((f) => resolve(dirname(details.sourceConfig), f)),
		resolve(root, "packages/vitest-config/src/defaults.ts"),
	];
	const started = Date.now(),
		startVersion = version();
	const metadata = {
		log: process.env.WALLPAPERDB_COVERAGE_REPO_LAUNCH_LOG || null,
		...details,
		directory,
		started,
		baseCommit: execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
			encoding: "utf8",
		}).trim(),
		startVersion,
		configs: Object.fromEntries(
			[...new Set(configPaths)]
				.filter(existsSync)
				.map((p) => [p, sha(readFileSync(p))]),
		),
	};
	writeFileSync(
		resolve(directory, "provenance.json"),
		JSON.stringify(metadata, null, 2),
	);
	writeFileSync(
		resolve(base, "latest.json"),
		JSON.stringify({ directory, started }, null, 2),
	);
	if (process.env.WALLPAPERDB_COVERAGE_REPO_LAUNCH_DIRECTORY)
		writeFileSync(
			resolve(
				process.env.WALLPAPERDB_COVERAGE_REPO_LAUNCH_DIRECTORY,
				"attempt.json",
			),
			JSON.stringify({ directory, started }, null, 2),
		);
	process.on("exit", (code) => {
		const endVersion = version();
		writeFileSync(
			resolve(directory, "exit.json"),
			JSON.stringify(
				{
					code,
					finished: Date.now(),
					seconds: (Date.now() - started) / 1000,
					endVersion,
					implementationChangedDuringRun:
						startVersion.sha256 !== endVersion.sha256,
				},
				null,
				2,
			),
		);
	});
	return directory;
}

// Capture the maintained checkout inputs, excluding generated/ignored artifacts.
// Publication and cross-shard merge must use the same source/configuration/tooling.
export function checkoutIdentity(root) {
	const files = execFileSync(
		"git",
		[
			"-C",
			root,
			"ls-files",
			"--cached",
			"--others",
			"--exclude-standard",
			"-z",
		],
		{ encoding: "utf8" },
	)
		.split("\0")
		.filter(Boolean);
	return sha(
		JSON.stringify(
			[...new Set(files)]
				.sort()
				.map((path) => [path, sha(readFileSync(resolve(root, path)))]),
		),
	);
}

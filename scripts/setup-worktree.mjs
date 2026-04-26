#!/usr/bin/env node
/**
 * setup-worktree.mjs
 *
 * Postinstall script that detects the current git worktree context, assigns a
 * unique slot number, and writes a .worktree file with port assignments and the
 * Docker Compose project name.
 *
 * Run automatically via package.json "postinstall" hook:
 *   node scripts/setup-worktree.mjs
 *
 * Idempotent: running multiple times produces the same .worktree file provided
 * the worktree slot hasn't changed.
 */

import { randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
	appendFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve, relative } from "node:path";
import {
	parseEnvValues,
	applyOverrides,
	extractKeys,
	filterApplicableSecrets,
	syncKnownSecretsToContent,
	resolveGenerateMarker,
} from "./lib/env-pipeline.mjs";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Read a UTF-8 file, returning its trimmed contents, or null if missing. */
function readFileSafe(filePath) {
	try {
		return readFileSync(filePath, "utf8").trim();
	} catch {
		return null;
	}
}

/** Resolve the repository root (the directory that contains .git or .git file). */
function findRepoRoot() {
	return resolve(process.cwd());
}

// ─── Worktree Detection ──────────────────────────────────────────────────────

/**
 * Returns { isWorktree, gitDir, worktreeName, worktreeGitRoot }
 *
 * - isWorktree: true when .git is a file (linked worktree)
 * - gitDir: the actual .git directory (main or pointed-to)
 * - worktreeName: name of the worktree entry in $GIT_COMMON_DIR/worktrees/<name>
 * - worktreeGitRoot: absolute path to the common .git directory
 */
function detectWorktreeContext(repoRoot) {
	const dotGitPath = join(repoRoot, ".git");

	let stat;
	try {
		stat = statSync(dotGitPath);
	} catch {
		throw new Error(`No .git entry found at ${dotGitPath}`);
	}

	if (stat.isDirectory()) {
		// Main checkout
		return {
			isWorktree: false,
			gitDir: dotGitPath,
			worktreeName: null,
			worktreeGitRoot: dotGitPath,
		};
	}

	if (stat.isFile()) {
		// Linked worktree — .git file contains "gitdir: <path>"
		const content = readFileSync(dotGitPath, "utf8").trim();
		const match = content.match(/^gitdir:\s*(.+)$/);
		if (!match) {
			throw new Error(
				`Unexpected .git file content (expected "gitdir: ..."): ${content}`,
			);
		}
		const gitDir = resolve(repoRoot, match[1]);
		// gitDir is e.g. /path/to/main/.git/worktrees/<name>
		// worktreeGitRoot is /path/to/main/.git
		const worktreesDir = join(gitDir, "..");
		const worktreeGitRoot = resolve(worktreesDir, "..");
		const worktreeName = gitDir.split("/").pop();

		return {
			isWorktree: true,
			gitDir,
			worktreeName,
			worktreeGitRoot,
		};
	}

	throw new Error(`.git at ${dotGitPath} is neither a file nor a directory`);
}

// ─── Branch Name ─────────────────────────────────────────────────────────────

/** Get the current branch name (or HEAD commit hash if detached). */
function getCurrentBranch(repoRoot) {
	try {
		const result = execSync("git rev-parse --abbrev-ref HEAD", {
			cwd: repoRoot,
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
		return result === "HEAD" ? "detached" : result;
	} catch {
		return "unknown";
	}
}

// ─── Slug Derivation ─────────────────────────────────────────────────────────

/**
 * Derive a Docker-safe project name suffix from a branch name.
 * Rules:
 *   - Replace `/` with `-`
 *   - Strip non-alphanumeric characters (except `-`)
 *   - Convert to lowercase
 *   - Truncate so "wallpaperdb-<slug>" is ≤ 63 characters
 *   - Final slug must not be empty
 */
function branchToSlug(branch) {
	const maxTotal = 63;
	const prefix = "wallpaperdb-";
	const maxSlugLen = maxTotal - prefix.length;

	let slug = branch
		.replace(/\//g, "-")
		.replace(/[^a-zA-Z0-9-]/g, "")
		.toLowerCase()
		.replace(/^-+|-+$/g, "") // trim leading/trailing hyphens
		.replace(/-+/g, "-"); // collapse multiple hyphens

	if (!slug) {
		slug = "worktree";
	}

	return slug.slice(0, maxSlugLen);
}

/** Derive the Docker Compose project name. Main checkout uses "wallpaperdb". */
function getProjectName(isWorktree, branch) {
	if (!isWorktree) {
		return "wallpaperdb";
	}
	const slug = branchToSlug(branch);
	return `wallpaperdb-${slug}`;
}

// ─── Port Computation ────────────────────────────────────────────────────────

/**
 * Port offsets (relative to base = 8000 + slot * 10):
 *   +0  INGRESS_PORT          (Caddy)
 *   +1  POSTGRES_HOST_PORT
 *   +2  MINIO_API_HOST_PORT
 *   +3  NATS_HOST_PORT
 *   +4  REDIS_HOST_PORT
 *   +5  OPENSEARCH_HOST_PORT
 *   +6  OTEL_HTTP_HOST_PORT
 *   +7  OTEL_GRPC_HOST_PORT
 */
function computePorts(slot) {
	const base = 8000 + slot * 10;
	return {
		INGRESS_PORT: base + 0,
		POSTGRES_HOST_PORT: base + 1,
		MINIO_API_HOST_PORT: base + 2,
		NATS_HOST_PORT: base + 3,
		REDIS_HOST_PORT: base + 4,
		OPENSEARCH_HOST_PORT: base + 5,
		OTEL_HTTP_HOST_PORT: base + 6,
		OTEL_GRPC_HOST_PORT: base + 7,
	};
}

// ─── Slot Management ─────────────────────────────────────────────────────────

/**
 * For main checkout: slot is always 0.
 * For a linked worktree:
 *   1. If a slot file already exists for this worktree, reuse it.
 *   2. Otherwise scan all existing slot files to find claimed slots and assign
 *      the lowest unclaimed integer ≥ 1.
 *
 * Returns the assigned slot number.
 */
function resolveSlot(context) {
	const { isWorktree, gitDir, worktreeGitRoot } = context;

	if (!isWorktree) {
		return 0;
	}

	const slotFilePath = join(gitDir, "worktree-slot");

	// 1. Reuse existing slot
	const existing = readFileSafe(slotFilePath);
	if (existing !== null) {
		const parsed = Number.parseInt(existing, 10);
		if (!Number.isNaN(parsed) && parsed >= 1) {
			return parsed;
		}
	}

	// 2. Scan all worktree slot files to find taken slots
	const claimedSlots = new Set();
	const worktreesDir = join(worktreeGitRoot, "worktrees");
	if (existsSync(worktreesDir)) {
		const entries = readdirSync(worktreesDir);
		for (const entry of entries) {
			const otherSlotFile = join(worktreesDir, entry, "worktree-slot");
			const val = readFileSafe(otherSlotFile);
			if (val !== null) {
				const n = Number.parseInt(val, 10);
				if (!Number.isNaN(n)) {
					claimedSlots.add(n);
				}
			}
		}
	}

	// Assign lowest unclaimed slot ≥ 1
	let slot = 1;
	while (claimedSlots.has(slot)) {
		slot++;
	}

	// Persist the slot
	writeFileSync(slotFilePath, String(slot), "utf8");
	return slot;
}

// ─── Stale Slot Detection ─────────────────────────────────────────────────────

/**
 * Scans all worktree slot files and warns if any reference a path that no
 * longer exists on disk.
 */
function checkStaleSlots(worktreeGitRoot) {
	const worktreesDir = join(worktreeGitRoot, "worktrees");
	if (!existsSync(worktreesDir)) {
		return;
	}

	const entries = readdirSync(worktreesDir);
	for (const entry of entries) {
		const worktreeMetaDir = join(worktreesDir, entry);
		const slotFile = join(worktreeMetaDir, "worktree-slot");
		if (!existsSync(slotFile)) {
			continue; // No slot file — not managed by this script
		}

		// The "gitdir" file in each worktree meta dir contains the path back to
		// the worktree's .git file, e.g.:
		//   /path/to/worktree/.git
		const gitdirFile = join(worktreeMetaDir, "gitdir");
		const gitdirContent = readFileSafe(gitdirFile);
		if (!gitdirContent) {
			continue;
		}

		// The worktree path is the directory containing the .git file
		const worktreePath = resolve(gitdirContent, "..");
		if (!existsSync(worktreePath)) {
			const slot = readFileSafe(slotFile);
			console.warn(
				`\n⚠️  Stale worktree slot detected:\n` +
					`   Slot:     ${slot}\n` +
					`   Worktree: ${worktreePath} (no longer exists)\n` +
					`   Slot file: ${slotFile}\n` +
					`\n` +
					`   To release this slot and clean up any Docker containers,\n` +
					`   run the following from this repository's root directory:\n` +
					`\n` +
					`     node scripts/teardown-worktree.mjs --slot-file "${slotFile}"\n` +
					`\n` +
					`   If Docker containers are already stopped, you can just delete\n` +
					`   the slot file directly:\n` +
					`     rm "${slotFile}"`,
			);
		}
	}
}

// ─── Slug Collision Detection ─────────────────────────────────────────────────

/**
 * Scans all linked worktrees and warns if two worktrees would produce the same
 * project name (slug collision).
 */
function checkSlugCollisions(worktreeGitRoot, thisProjectName) {
	const worktreesDir = join(worktreeGitRoot, "worktrees");
	if (!existsSync(worktreesDir)) {
		return;
	}

	const seen = new Map(); // projectName → worktreePath

	const entries = readdirSync(worktreesDir);
	for (const entry of entries) {
		const worktreeMetaDir = join(worktreesDir, entry);
		const gitdirFile = join(worktreeMetaDir, "gitdir");
		const gitdirContent = readFileSafe(gitdirFile);
		if (!gitdirContent) {
			continue;
		}

		const worktreePath = resolve(gitdirContent, "..");
		if (!existsSync(worktreePath)) {
			continue; // Stale — already warned above
		}

		// Read HEAD to get the branch
		const headFile = join(worktreeMetaDir, "HEAD");
		const headContent = readFileSafe(headFile);
		if (!headContent) {
			continue;
		}
		let branch;
		const refMatch = headContent.match(/^ref: refs\/heads\/(.+)$/);
		if (refMatch) {
			branch = refMatch[1];
		} else {
			branch = headContent.slice(0, 8); // detached HEAD — use short hash
		}

		const projectName = getProjectName(true, branch);
		if (seen.has(projectName)) {
			console.warn(
				`\n⚠️  Slug collision detected:\n` +
					`   Project name: ${projectName}\n` +
					`   Worktree 1: ${seen.get(projectName)}\n` +
					`   Worktree 2: ${worktreePath}\n` +
					`   Both worktrees would use the same Docker project name!\n` +
					`   Rename one branch to resolve this conflict.`,
			);
		} else {
			seen.set(projectName, worktreePath);
		}
	}
}

// ─── .worktree File ───────────────────────────────────────────────────────────

/** Build the contents of the .worktree file as a Make-compatible KEY=VALUE string. */
function buildWorktreeFileContent(slot, projectName, ports) {
	return [
		`WORKTREE_SLOT=${slot}`,
		`COMPOSE_PROJECT_NAME=${projectName}`,
		`INGRESS_PORT=${ports.INGRESS_PORT}`,
		`POSTGRES_HOST_PORT=${ports.POSTGRES_HOST_PORT}`,
		`MINIO_API_HOST_PORT=${ports.MINIO_API_HOST_PORT}`,
		`NATS_HOST_PORT=${ports.NATS_HOST_PORT}`,
		`REDIS_HOST_PORT=${ports.REDIS_HOST_PORT}`,
		`OPENSEARCH_HOST_PORT=${ports.OPENSEARCH_HOST_PORT}`,
		`OTEL_HTTP_HOST_PORT=${ports.OTEL_HTTP_HOST_PORT}`,
		`OTEL_GRPC_HOST_PORT=${ports.OTEL_GRPC_HOST_PORT}`,
		"", // trailing newline
	].join("\n");
}

// ─── Docker Compose Version Check ────────────────────────────────────────────

/** Parse a semver-like string and return [major, minor, patch]. */
function parseSemver(str) {
	const match = str.match(/(\d+)\.(\d+)\.(\d+)/);
	if (!match) {
		return null;
	}
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Check that `docker compose` is ≥ 2.22.
 * Prints a warning (but does NOT fail) if the requirement is not met.
 */
function checkDockerComposeVersion() {
	try {
		const output = execSync("docker compose version --short 2>/dev/null", {
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();

		const version = parseSemver(output);
		if (!version) {
			console.warn(
				`\n⚠️  Could not parse docker compose version: "${output}"\n` +
					`   docker compose ≥ 2.22 is required for "docker compose watch" (used by make dev).\n` +
					`   Current setup will work; upgrade before running "make dev".`,
			);
			return;
		}

		const [major, minor] = version;
		const meetsRequirement =
			major > 2 || (major === 2 && minor >= 22);
		if (!meetsRequirement) {
			console.warn(
				`\n⚠️  docker compose version ${output} is below the required ≥ 2.22.\n` +
					`   "docker compose watch" (used by make dev for hot reload) requires ≥ 2.22.\n` +
					`   Current setup will work; upgrade Docker Desktop before running "make dev".`,
			);
		}
	} catch {
		console.warn(
			`\n⚠️  Could not check docker compose version (docker not found or not running).\n` +
				`   docker compose ≥ 2.22 is required for "docker compose watch" (used by make dev).\n` +
				`   Current setup will work; install Docker Desktop to use the full dev workflow.`,
		);
	}
}

// ─── Env File Discovery ─────────────────────────────────────────────────────

/**
 * Recursively find all `.env.example` files under `dir`.
 * Returns relative paths from `dir`.
 */
function findEnvExamples(dir) {
	const results = [];
	const entries = readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.name === "node_modules") continue;
		if (entry.isDirectory() && entry.name.startsWith(".")) continue;
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...findEnvExamples(fullPath));
		} else if (entry.name === ".env.example") {
			results.push(fullPath);
		}
	}
	return results;
}

// ─── Dotenv Parser ──────────────────────────────────────────────────────────
// parseEnvValues is imported from ./lib/env-pipeline.mjs

// ─── Override Maps ──────────────────────────────────────────────────────────

const globalOverrides = {
	S3_ENDPOINT: "http://minio:9000",
	NATS_URL: "nats://nats:4222",
	OTEL_EXPORTER_OTLP_ENDPOINT: "http://lgtm:4318",
	REDIS_HOST: "redis",
	REDIS_PORT: "6379",
	REDIS_ENABLED: "true",
};

function buildServiceOverrides() {
	return {
		infra: {
			COMPOSE_PROJECT_NAME: (ctx) => ctx.projectName,
			INGRESS_PORT: (ctx) => String(ctx.ports.INGRESS_PORT),
			POSTGRES_HOST_PORT: (ctx) => String(ctx.ports.POSTGRES_HOST_PORT),
			MINIO_API_HOST_PORT: (ctx) => String(ctx.ports.MINIO_API_HOST_PORT),
			NATS_HOST_PORT: (ctx) => String(ctx.ports.NATS_HOST_PORT),
			REDIS_HOST_PORT: (ctx) => String(ctx.ports.REDIS_HOST_PORT),
			OPENSEARCH_HOST_PORT: (ctx) => String(ctx.ports.OPENSEARCH_HOST_PORT),
			OTEL_HTTP_HOST_PORT: (ctx) => String(ctx.ports.OTEL_HTTP_HOST_PORT),
			OTEL_GRPC_HOST_PORT: (ctx) => String(ctx.ports.OTEL_GRPC_HOST_PORT),
		},
		"apps/ingestor": {
			DATABASE_URL:
				"postgresql://wallpaperdb:wallpaperdb@postgres:5432/wallpaperdb_ingestor",
		},
		"apps/media": {
			DATABASE_URL:
				"postgresql://wallpaperdb:wallpaperdb@postgres:5432/wallpaperdb_media",
		},
		"apps/gateway": {
			OPENSEARCH_URL: "http://opensearch:9200",
			MEDIA_SERVICE_URL: (ctx) =>
				`http://localhost:${ctx.ports.INGRESS_PORT}/media`,
		},
		"apps/variant-generator": {},
		"apps/color-extractor": {},
		"apps/web": {
			VITE_BASE_PATH: "/web",
			VITE_GATEWAY_URL: (ctx) =>
				`http://localhost:${ctx.ports.INGRESS_PORT}/gateway/graphql`,
			VITE_INGESTOR_URL: (ctx) =>
				`http://localhost:${ctx.ports.INGRESS_PORT}/ingestor`,
		},
	};
}

// ─── User Secrets ───────────────────────────────────────────────────────────

const knownUserSecrets = {
	CURSOR_SECRET: () => randomBytes(32).toString("hex"),
	VITE_CLERK_PUBLISHABLE_KEY: undefined,
    CLERK_DOMAIN: undefined
};

function getSecretEnvPath() {
	const configDir =
		process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
	return join(configDir, "wallpaperdb", "secret.env");
}

function ensureSecretEnv(secretEnvPath) {
	const dir = join(secretEnvPath, "..");
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}

	if (!existsSync(secretEnvPath)) {
		const header =
			"# You can use this file to store actual secret values needed by all worktrees\n";
		writeFileSync(secretEnvPath, header, "utf8");
	}
}

function syncKnownSecrets(secretEnvPath) {
	const existing = existsSync(secretEnvPath)
		? readFileSync(secretEnvPath, "utf8")
		: "";
	const updated = syncKnownSecretsToContent(existing, knownUserSecrets);
	if (updated !== existing) {
		writeFileSync(secretEnvPath, updated, "utf8");
	}
}

function loadSecrets(secretEnvPath) {
	if (!existsSync(secretEnvPath)) return {};
	const content = readFileSync(secretEnvPath, "utf8");
	const { secrets, content: updated } = resolveGenerateMarker(
		content,
		knownUserSecrets,
	);
	if (updated !== content) {
		writeFileSync(secretEnvPath, updated, "utf8");
	}
	return secrets;
}

// ─── Unified .env Generation Pipeline ───────────────────────────────────────

// applyOverrides is imported from ./lib/env-pipeline.mjs

/**
 * Generate all `.env` files using a unified 4-step pipeline:
 *   1. Read `.env.example` as base
 *   2. Apply global overrides
 *   3. Apply service-specific overrides
 *   4. Apply user secrets from `secret.env`
 */
function generateAllEnvFiles(repoRoot, projectName, ports) {
	const ctx = { projectName, ports };
	const serviceOverrides = buildServiceOverrides();
	const secretEnvPath = getSecretEnvPath();

	ensureSecretEnv(secretEnvPath);
	syncKnownSecrets(secretEnvPath);
	const secrets = loadSecrets(secretEnvPath);

	const exampleFiles = findEnvExamples(repoRoot);

	for (const examplePath of exampleFiles) {
		const dir = relative(repoRoot, join(examplePath, ".."));
		const envPath = join(repoRoot, dir, ".env");

		const exampleContent = readFileSafe(examplePath);
		if (exampleContent === null) {
			console.warn(
				`\n⚠️  Could not read ${examplePath} — skipping ${dir}/.env generation.`,
			);
			continue;
		}

		const exampleKeys = extractKeys(exampleContent);

		let content = exampleContent;

		const filteredGlobals = {};
		for (const [key, val] of Object.entries(globalOverrides)) {
			if (exampleKeys.has(key)) filteredGlobals[key] = val;
		}
		content = applyOverrides(content, filteredGlobals, ctx);

		const svc = serviceOverrides[dir];
		if (svc) {
			content = applyOverrides(content, svc, ctx);
		}

		const applicableSecrets = filterApplicableSecrets(
			secrets,
			exampleKeys,
			dir,
			console.log,
		);
		content = applyOverrides(content, applicableSecrets, ctx);

		const existing = readFileSafe(envPath);
		if (existing === content.trimEnd()) continue;

		writeFileSync(envPath, content, "utf8");
	}
}

// ─── Bruno Environment Generation ─────────────────────────────────────────────

/**
 * Generates `api/environments/local.bru` from `api/environments/local.bru.example`,
 * overriding the dynamic URL variables with ingress-based URLs computed for this
 * worktree's slot.
 *
 * Bruno is an API client that stores request collections in `api/`. Each request
 * references variables like {{baseUrl}}, {{gatewayBaseUrl}}, and {{mediaBaseUrl}}
 * that are resolved from the active environment file.
 *
 * Idempotent: only writes the file when the content has changed.
 */
function generateBrunoEnv(repoRoot, ports) {
	const examplePath = join(repoRoot, "api", "environments", "local.bru.example");
	const envPath = join(repoRoot, "api", "environments", "local.bru");

	const example = readFileSafe(examplePath);
	if (example === null) {
		console.warn(
			`\n⚠️  Could not read ${examplePath} — skipping Bruno environment generation.`,
		);
		return;
	}

	const ingressPort = ports.INGRESS_PORT;

	const overrides = {
		baseUrl: `http://localhost:${ingressPort}/ingestor`,
		mediaBaseUrl: `http://localhost:${ingressPort}/media`,
		gatewayBaseUrl: `http://localhost:${ingressPort}/gateway`,
		colorExtractorBaseUrl: `http://localhost:${ingressPort}/color-extractor`,
	};

	const lines = example.split("\n");
	const seen = new Set();
	const updatedLines = lines.map((line) => {
		const match = line.match(/^(\s*)([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
		if (match) {
			const [, indent, key] = match;
			if (key in overrides) {
				seen.add(key);
				return `${indent}${key}: ${overrides[key]}`;
			}
		}
		return line;
	});

	const newContent = updatedLines.join("\n");

	const existing = readFileSafe(envPath);
	if (existing === newContent.trimEnd()) {
		return;
	}

	writeFileSync(envPath, newContent, "utf8");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
	const repoRoot = findRepoRoot();
	const worktreeFilePath = join(repoRoot, ".worktree");

	// Skip gracefully when there is no .git (e.g. inside a Docker build context
	// where .git is excluded by .dockerignore). Nothing to assign in that case.
	const dotGitPath = join(repoRoot, ".git");
	if (!existsSync(dotGitPath)) {
		console.log(
			"[setup-worktree] No .git found — skipping (Docker or non-git context).",
		);
		return;
	}

	// 1. Detect context
	const context = detectWorktreeContext(repoRoot);

	// 2. Stale slot + collision detection (informational only)
	checkStaleSlots(context.worktreeGitRoot);
	if (context.isWorktree) {
		checkSlugCollisions(context.worktreeGitRoot, null);
	}

	// 3. Resolve slot
	const slot = resolveSlot(context);

	// 4. Derive project name
	const branch = getCurrentBranch(repoRoot);
	const projectName = getProjectName(context.isWorktree, branch);

	// 5. Detect slug collisions now that we know our project name
	if (context.isWorktree) {
		// Already called above for all worktrees; this is just informational
	}

	// 6. Compute ports
	const ports = computePorts(slot);

	// 7. Build file content
	const newContent = buildWorktreeFileContent(slot, projectName, ports);

	// 8. Idempotency check — only write if content changed
	const existingContent = readFileSafe(worktreeFilePath);
	const worktreeUnchanged = existingContent === newContent.trim();

	if (worktreeUnchanged) {
		generateAllEnvFiles(repoRoot, projectName, ports);
		generateBrunoEnv(repoRoot, ports);
		console.log(
			`[setup-worktree] Worktree slot ${slot} already assigned. ` +
				`Ingress: http://localhost:${ports.INGRESS_PORT} — no changes needed.`,
		);
		checkDockerComposeVersion();
		return;
	}

	// 9. Write .worktree file
	writeFileSync(worktreeFilePath, newContent, "utf8");

	// 9b. Generate .env files and Bruno environment
	generateAllEnvFiles(repoRoot, projectName, ports);
	generateBrunoEnv(repoRoot, ports);

	// 10. Summary
	console.log(
		`[setup-worktree] Worktree slot ${slot} assigned.\n` +
			`  Project name : ${projectName}\n` +
			`  Ingress      : http://localhost:${ports.INGRESS_PORT}\n` +
			`  Postgres     : localhost:${ports.POSTGRES_HOST_PORT}\n` +
			`  MinIO API    : localhost:${ports.MINIO_API_HOST_PORT}\n` +
			`  NATS         : localhost:${ports.NATS_HOST_PORT}\n` +
			`  Redis        : localhost:${ports.REDIS_HOST_PORT}\n` +
			`  OpenSearch   : localhost:${ports.OPENSEARCH_HOST_PORT}\n` +
			`  OTEL HTTP    : localhost:${ports.OTEL_HTTP_HOST_PORT}\n` +
			`  OTEL gRPC    : localhost:${ports.OTEL_GRPC_HOST_PORT}`,
	);

	checkDockerComposeVersion();
}

main();

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
} from "node:fs";
import { join, resolve } from "node:path";

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

// ─── Infra .env Generation ────────────────────────────────────────────────────

/**
 * Generates `infra/.env` from `infra/.env.example`, overriding the dynamic
 * port variables and COMPOSE_PROJECT_NAME with values computed for this
 * worktree's slot.
 *
 * Idempotent: only writes the file when the content has changed.
 */
function generateInfraEnv(repoRoot, projectName, ports) {
	const examplePath = join(repoRoot, "infra", ".env.example");
	const envPath = join(repoRoot, "infra", ".env");

	const example = readFileSafe(examplePath);
	if (example === null) {
		console.warn(
			`\n⚠️  Could not read ${examplePath} — skipping infra/.env generation.`,
		);
		return;
	}

	/** Overrides to apply on top of the example file. */
	const overrides = {
		COMPOSE_PROJECT_NAME: projectName,
		INGRESS_PORT: String(ports.INGRESS_PORT),
		POSTGRES_HOST_PORT: String(ports.POSTGRES_HOST_PORT),
		MINIO_API_HOST_PORT: String(ports.MINIO_API_HOST_PORT),
		NATS_HOST_PORT: String(ports.NATS_HOST_PORT),
		REDIS_HOST_PORT: String(ports.REDIS_HOST_PORT),
		OPENSEARCH_HOST_PORT: String(ports.OPENSEARCH_HOST_PORT),
		OTEL_HTTP_HOST_PORT: String(ports.OTEL_HTTP_HOST_PORT),
		OTEL_GRPC_HOST_PORT: String(ports.OTEL_GRPC_HOST_PORT),
	};

	// Process the example file line by line, replacing known keys.
	const lines = example.split("\n");
	const seen = new Set();

	const updatedLines = lines.map((line) => {
		// Match KEY=value lines (ignore comments and blanks)
		const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
		if (match) {
			const key = match[1];
			if (key in overrides) {
				seen.add(key);
				return `${key}=${overrides[key]}`;
			}
		}
		return line;
	});

	// Append any override keys that were not present in the example file.
	for (const [key, value] of Object.entries(overrides)) {
		if (!seen.has(key)) {
			updatedLines.push(`${key}=${value}`);
		}
	}

	const newContent = updatedLines.join("\n");

	// Idempotency check
	const existing = readFileSafe(envPath);
	if (existing === newContent.trimEnd()) {
		return; // No change
	}

	writeFileSync(envPath, newContent, "utf8");
}

// ─── App .env Generation ──────────────────────────────────────────────────────

/**
 * Parse KEY=value lines from an env file string.
 * Returns a plain object mapping key → raw value string.
 * Lines that don't match KEY=value (comments, blanks) are ignored.
 */
function parseEnvValues(content) {
	const values = Object.create(null);
	for (const line of content.split("\n")) {
		const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
		if (match) {
			values[match[1]] = match[2];
		}
	}
	return values;
}

/**
 * Generate a single app's .env file from its .env.example, applying the
 * given overrides.
 *
 * - Lines from .env.example whose key appears in `overrides` are replaced.
 * - Keys in `overrides` not present in .env.example are appended.
 * - When `special === 'gateway'`, CURSOR_SECRET is auto-generated on first
 *   run and preserved on subsequent runs (unless still the placeholder).
 * - Idempotent: the file is only written when content changes.
 */
function generateAppEnv(repoRoot, appDir, overrides, special) {
	const examplePath = join(repoRoot, appDir, ".env.example");
	const envPath = join(repoRoot, appDir, ".env");

	const exampleContent = readFileSafe(examplePath);
	if (exampleContent === null) {
		console.warn(
			`\n⚠️  Could not read ${examplePath} — skipping ${appDir}/.env generation.`,
		);
		return;
	}

	// Work with a mutable copy of overrides so we can inject CURSOR_SECRET.
	const appliedOverrides = { ...overrides };

	// Gateway: auto-generate CURSOR_SECRET on first run, preserve on re-runs.
	if (special === "gateway") {
		const existingEnv = readFileSafe(envPath);
		const existingValues = existingEnv ? parseEnvValues(existingEnv) : {};
		const existingSecret = existingValues.CURSOR_SECRET;
		const isPlaceholder =
			!existingSecret || existingSecret === "<REPLACE_WITH_RANDOM_SECRET>";
		appliedOverrides.CURSOR_SECRET = isPlaceholder
			? randomBytes(32).toString("hex")
			: existingSecret;
	}

	// Process example file lines, replacing overridden keys.
	const lines = exampleContent.split("\n");
	const seen = new Set();
	const updatedLines = lines.map((line) => {
		const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
		if (match) {
			const key = match[1];
			if (key in appliedOverrides) {
				seen.add(key);
				return `${key}=${appliedOverrides[key]}`;
			}
		}
		return line;
	});

	// Append keys that were not found in the example file.
	for (const [key, value] of Object.entries(appliedOverrides)) {
		if (!seen.has(key)) {
			updatedLines.push(`${key}=${value}`);
		}
	}

	const newContent = updatedLines.join("\n");

	// Idempotency: only write if content has changed.
	const existingContent = readFileSafe(envPath);
	if (existingContent === newContent.trimEnd()) {
		return;
	}

	writeFileSync(envPath, newContent, "utf8");
}

/**
 * Generate .env files for all 5 apps. Uses Docker-internal service hostnames
 * (postgres, minio, nats, redis, lgtm, opensearch) for server-side connections
 * and browser-reachable URLs (via the ingress) for client-side connections.
 *
 * Called from main() after slot assignment and port computation.
 *
 * NOTE: After generation, .env files point to Docker service names. Developers
 * running services on the host (without Docker) should restore host-based
 * values by running: cp apps/<name>/.env.example apps/<name>/.env
 * (or use `make env-host` if that target exists).
 */
function generateAppEnvFiles(repoRoot, ports) {
	const ingressPort = ports.INGRESS_PORT;

	generateAppEnv(repoRoot, "apps/ingestor", {
		DATABASE_URL:
			"postgresql://wallpaperdb:wallpaperdb@postgres:5432/wallpaperdb_ingestor",
		S3_ENDPOINT: "http://minio:9000",
		NATS_URL: "nats://nats:4222",
		REDIS_HOST: "redis",
		REDIS_PORT: "6379",
		REDIS_ENABLED: "true",
		OTEL_EXPORTER_OTLP_ENDPOINT: "http://lgtm:4318",
	});

	generateAppEnv(repoRoot, "apps/media", {
		DATABASE_URL:
			"postgresql://wallpaperdb:wallpaperdb@postgres:5432/wallpaperdb_media",
		S3_ENDPOINT: "http://minio:9000",
		NATS_URL: "nats://nats:4222",
		OTEL_EXPORTER_OTLP_ENDPOINT: "http://lgtm:4318",
	});

	generateAppEnv(
		repoRoot,
		"apps/gateway",
		{
			OPENSEARCH_URL: "http://opensearch:9200",
			NATS_URL: "nats://nats:4222",
			REDIS_HOST: "redis",
			OTEL_EXPORTER_OTLP_ENDPOINT: "http://lgtm:4318",
			MEDIA_SERVICE_URL: `http://localhost:${ingressPort}/media`,
		},
		"gateway",
	);

	generateAppEnv(repoRoot, "apps/variant-generator", {
		S3_ENDPOINT: "http://minio:9000",
		NATS_URL: "nats://nats:4222",
		OTEL_EXPORTER_OTLP_ENDPOINT: "http://lgtm:4318",
	});

	generateAppEnv(repoRoot, "apps/web", {
		VITE_BASE_PATH: "/web",
		VITE_GATEWAY_URL: `http://localhost:${ingressPort}/gateway/graphql`,
		VITE_INGESTOR_URL: `http://localhost:${ingressPort}/ingestor`,
	});
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
		// .worktree file is up-to-date; still regenerate infra/.env, app
		// .env files, and Bruno env in case they were deleted or example
		// files changed.
		generateInfraEnv(repoRoot, projectName, ports);
		generateAppEnvFiles(repoRoot, ports);
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

	// 9b. Generate infra/.env, app .env files, and Bruno environment
	generateInfraEnv(repoRoot, projectName, ports);
	generateAppEnvFiles(repoRoot, ports);
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

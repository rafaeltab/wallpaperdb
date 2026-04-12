#!/usr/bin/env node
/**
 * teardown-worktree.mjs
 *
 * Called by `make worktree-remove`. Stops Docker containers for this worktree,
 * removes volumes (unless this is the main worktree, slot 0), and releases the
 * slot file.
 *
 * Usage:
 *   node scripts/teardown-worktree.mjs
 *     Standard mode: reads .worktree from cwd, tears down this worktree's
 *     containers and releases its slot.
 *
 *   node scripts/teardown-worktree.mjs --slot-file <path>
 *     Stale cleanup mode: tears down containers for a stale worktree whose
 *     directory no longer exists. <path> is the absolute path to the slot file
 *     in .git/worktrees/<name>/worktree-slot.
 */

import { execSync } from "node:child_process";
import {
	existsSync,
	readFileSync,
	statSync,
	unlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Read a UTF-8 file, returning its trimmed contents, or null if missing. */
function readFileSafe(filePath) {
	try {
		return readFileSync(filePath, "utf8").trim();
	} catch {
		return null;
	}
}

/**
 * Parse KEY=VALUE lines from a .env / .worktree file.
 * Returns a plain object mapping key → value string.
 * Comments and blank lines are ignored.
 */
function parseKeyValue(content) {
	const result = Object.create(null);
	for (const line of content.split("\n")) {
		const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
		if (match) {
			result[match[1]] = match[2];
		}
	}
	return result;
}

/**
 * Derive a Docker-safe project name suffix from a branch name.
 * Must match the logic in setup-worktree.mjs exactly.
 */
function branchToSlug(branch) {
	const maxTotal = 63;
	const prefix = "wallpaperdb-";
	const maxSlugLen = maxTotal - prefix.length;

	let slug = branch
		.replace(/\//g, "-")
		.replace(/[^a-zA-Z0-9-]/g, "")
		.toLowerCase()
		.replace(/^-+|-+$/g, "")
		.replace(/-+/g, "-");

	if (!slug) {
		slug = "worktree";
	}

	return slug.slice(0, maxSlugLen);
}

function getProjectName(branch) {
	const slug = branchToSlug(branch);
	return `wallpaperdb-${slug}`;
}

/**
 * Run a docker compose down command.
 * Returns true on success, false if docker compose reports no running project
 * (which is acceptable — the containers may already be gone).
 */
function runComposeDown(projectName, composeFile, removeVolumes) {
	if (!existsSync(composeFile)) {
		console.log(`  [skip] ${composeFile} not found — nothing to tear down.`);
		return;
	}

	const volumesFlag = removeVolumes ? "--volumes" : "";
	const cmd = [
		"docker compose",
		`-p "${projectName}"`,
		`-f "${composeFile}"`,
		"down",
		volumesFlag,
		"--remove-orphans",
	]
		.filter(Boolean)
		.join(" ");

	console.log(`  $ ${cmd}`);
	try {
		execSync(cmd, { stdio: "inherit" });
	} catch (err) {
		// Exit code 1 from docker compose down is common when there's nothing
		// running. Treat it as a soft warning, not a hard failure.
		console.warn(`  Warning: docker compose down exited with error (this may be normal if no containers were running).`);
	}
}

// ─── Normal teardown (run from inside the worktree) ──────────────────────────

function runNormalTeardown(repoRoot) {
	const worktreeFilePath = join(repoRoot, ".worktree");

	const worktreeContent = readFileSafe(worktreeFilePath);
	if (worktreeContent === null) {
		console.error(
			"Error: .worktree file not found.\n" +
				"Run `pnpm install` first to generate it, or use:\n" +
				"  node scripts/teardown-worktree.mjs --slot-file <path>\n" +
				"for stale cleanup.",
		);
		process.exit(1);
	}

	const vars = parseKeyValue(worktreeContent);
	const projectName = vars.COMPOSE_PROJECT_NAME;
	const slot = Number.parseInt(vars.WORKTREE_SLOT ?? "", 10);

	if (!projectName) {
		console.error("Error: COMPOSE_PROJECT_NAME not found in .worktree file.");
		process.exit(1);
	}
	if (Number.isNaN(slot)) {
		console.error("Error: WORKTREE_SLOT not found or invalid in .worktree file.");
		process.exit(1);
	}

	const isMainWorktree = slot === 0;
	const removeVolumes = !isMainWorktree;

	console.log(
		`\nTearing down worktree: ${projectName} (slot ${slot})`,
	);
	if (isMainWorktree) {
		console.log(
			"  Note: This is the main worktree (slot 0). Volumes will be preserved.",
		);
	}

	// Stop apps compose first (depends on infra network)
	const appsComposePath = join(repoRoot, "infra", "docker-compose.apps.yml");
	runComposeDown(projectName, appsComposePath, removeVolumes);

	// Then stop infra
	const infraComposePath = join(repoRoot, "infra", "docker-compose.yml");
	runComposeDown(projectName, infraComposePath, removeVolumes);

	// Release slot file (only for linked worktrees)
	if (!isMainWorktree) {
		releaseSlotFromWorktreeRoot(repoRoot);
	}

	console.log(
		`\nTeardown complete for project "${projectName}".\n` +
			(isMainWorktree
				? "  Infra volumes preserved (main worktree).\n"
				: "  Volumes removed. Slot released.\n") +
			"  You can now run: git worktree remove <path>",
	);
}

/**
 * Find and delete the worktree-slot file for the linked worktree at repoRoot.
 * The .git file in the worktree points to .git/worktrees/<name>/ which
 * contains the slot file.
 */
function releaseSlotFromWorktreeRoot(repoRoot) {
	const dotGitPath = join(repoRoot, ".git");

	let stat;
	try {
		stat = statSync(dotGitPath);
	} catch {
		console.warn("  Warning: Could not stat .git — slot file not released.");
		return;
	}

	if (stat.isDirectory()) {
		// Main worktree — no slot file to release (slot 0)
		return;
	}

	if (stat.isFile()) {
		const content = readFileSafe(dotGitPath);
		const match = content?.match(/^gitdir:\s*(.+)$/);
		if (!match) {
			console.warn("  Warning: Unexpected .git file format — slot file not released.");
			return;
		}
		const gitDir = resolve(repoRoot, match[1]);
		const slotFilePath = join(gitDir, "worktree-slot");
		releaseSlotFile(slotFilePath);
	}
}

// ─── Stale cleanup (run from any worktree, target a specific slot file) ──────

function runStaleCleanup(slotFilePath) {
	const resolvedSlotFile = resolve(slotFilePath);

	if (!existsSync(resolvedSlotFile)) {
		console.error(`Error: Slot file not found: ${resolvedSlotFile}`);
		process.exit(1);
	}

	// The slot file lives at: .git/worktrees/<name>/worktree-slot
	// The worktree meta dir is its parent.
	const worktreeMetaDir = resolve(resolvedSlotFile, "..");

	// Read the branch from the HEAD file in the meta dir to derive project name.
	const headFile = join(worktreeMetaDir, "HEAD");
	const headContent = readFileSafe(headFile);
	if (!headContent) {
		console.error(`Error: Could not read HEAD from ${headFile}`);
		process.exit(1);
	}

	let branch;
	const refMatch = headContent.match(/^ref: refs\/heads\/(.+)$/);
	if (refMatch) {
		branch = refMatch[1];
	} else {
		// Detached HEAD — use short hash
		branch = headContent.slice(0, 8);
	}

	const projectName = getProjectName(branch);
	const slot = readFileSafe(resolvedSlotFile);

	console.log(
		`\nStale cleanup for project: ${projectName} (slot ${slot}, branch: ${branch})`,
	);
	console.log(
		"  Note: This worktree no longer exists on disk. Volumes will be removed.",
	);

	// Use cwd as repo root (user should run this from the main worktree)
	const repoRoot = process.cwd();

	// Stop apps compose first
	const appsComposePath = join(repoRoot, "infra", "docker-compose.apps.yml");
	runComposeDown(projectName, appsComposePath, true);

	// Then stop infra
	const infraComposePath = join(repoRoot, "infra", "docker-compose.yml");
	runComposeDown(projectName, infraComposePath, true);

	// Release the slot file
	releaseSlotFile(resolvedSlotFile);

	console.log(
		`\nStale cleanup complete for project "${projectName}".\n` +
			"  Slot released. Volumes removed (if any were running).",
	);
}

// ─── Slot file release ────────────────────────────────────────────────────────

function releaseSlotFile(slotFilePath) {
	if (!existsSync(slotFilePath)) {
		console.log(`  Slot file already absent: ${slotFilePath}`);
		return;
	}
	try {
		unlinkSync(slotFilePath);
		console.log(`  Slot file released: ${slotFilePath}`);
	} catch (err) {
		console.warn(`  Warning: Could not delete slot file ${slotFilePath}: ${err.message}`);
	}
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const slotFileArgIndex = args.indexOf("--slot-file");

if (slotFileArgIndex !== -1) {
	const slotFilePath = args[slotFileArgIndex + 1];
	if (!slotFilePath) {
		console.error("Error: --slot-file requires a path argument.");
		process.exit(1);
	}
	runStaleCleanup(slotFilePath);
} else {
	runNormalTeardown(process.cwd());
}

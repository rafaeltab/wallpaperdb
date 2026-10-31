import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const migrationRoot = "apps/asset/drizzle";
const scriptRoot = "apps/asset/scripts";

// Make owns expansion, defaults, duplicate assignments and selector validation.
export function assetMigrationSelected(root, mode, targets) {
	if (mode !== "development" || targets[0] !== "migrate") return false;
	return (
		execFileSync(
			"make",
			[
				"--no-print-directory",
				"-s",
				"BOAT_EXEC=worker",
				...targets.slice(1),
				"--eval=.PHONY: _boat_asset_selector",
				"--eval=_boat_asset_selector: ; @echo '$(PACKAGE)'",
				"_boat_asset_selector",
			],
			{ cwd: root, encoding: "utf8" },
		).trim() === "asset"
	);
}

function regular(root, name) {
	const parts = name.split("/");
	if (parts.some((p) => !p || p === "." || p === ".."))
		throw Error("Invalid migration input path");
	for (let i = 1; i < parts.length; i++)
		if (!fs.lstatSync(path.join(root, ...parts.slice(0, i))).isDirectory())
			throw Error(`Nonregular migration ancestor: ${name}`);
	const file = path.join(root, name);
	if (!fs.lstatSync(file).isFile())
		throw Error(`Nonregular migration input: ${name}`);
	return fs.readFileSync(file);
}
function members(root, directory) {
	const result = [];
	function visit(name) {
		const stat = fs.lstatSync(path.join(root, name));
		if (stat.isDirectory())
			for (const entry of fs.readdirSync(path.join(root, name)).sort())
				visit(`${name}/${entry}`);
		else {
			regular(root, name);
			result.push(name);
		}
	}
	if (fs.existsSync(path.join(root, directory))) visit(directory);
	return result.sort();
}

// Capture only accepted public source. Private generated configuration is never a receipt input.
export function captureAssetMigration(root, source) {
	const migrations = members(root, migrationRoot),
		scripts = members(root, scriptRoot);
	const journalName = `${migrationRoot}/meta/_journal.json`;
	const journal = JSON.parse(regular(root, journalName));
	if (!Array.isArray(journal.entries)) throw Error("Invalid migration journal");
	const required = [journalName];
	for (const [idx, entry] of journal.entries.entries()) {
		if (
			entry.idx !== idx ||
			!new RegExp(`^${String(idx).padStart(4, "0")}_[\\w-]+$`).test(entry.tag)
		)
			throw Error("Invalid migration journal membership");
		required.push(
			`${migrationRoot}/${entry.tag}.sql`,
			`${migrationRoot}/meta/${String(idx).padStart(4, "0")}_snapshot.json`,
		);
	}
	if (JSON.stringify(required.sort()) !== JSON.stringify(migrations))
		throw Error("Incomplete migration journal membership");
	const names = new Set([
		...migrations,
		...scripts,
		"apps/asset/package.json",
		"apps/asset/drizzle.config.ts",
		"package.json",
		"pnpm-lock.yaml",
		"pnpm-workspace.yaml",
	]);
	for (const name of [
		"apps/asset/tsconfig.json",
		"tsconfig.base.json",
		".npmrc",
	])
		if (Object.hasOwn(source, name)) names.add(name);
	// Follow actual source imports, including workspace imports, rather than naming a historical backfill.
	const ts = createRequire(import.meta.url)("typescript");
	const command = JSON.parse(regular(root, "apps/asset/package.json"))
		.scripts?.["db:migrate"];
	if (typeof command !== "string" || !command)
		throw Error("Asset package has no db:migrate script");
	const imports = new Set(["apps/asset/drizzle.config.ts"]);
	for (const match of command.matchAll(
		/\b(?:tsx|node)\s+([.\w/-]+\.[cm]?[jt]sx?)\b/g,
	)) {
		const name = path.posix.normalize(`apps/asset/${match[1]}`);
		if (!Object.hasOwn(source, name))
			throw Error("Migration script outside accepted source");
		names.add(name);
		imports.add(name);
	}
	for (const name of imports) {
		if (!/\.[cm]?[jt]sx?$/.test(name)) continue;
		for (const entry of ts.preProcessFile(
			regular(root, name).toString(),
			true,
			true,
		).importedFiles) {
			const resolved = ts.resolveModuleName(
				entry.fileName,
				path.join(root, name),
				{ moduleResolution: ts.ModuleResolutionKind.Bundler, allowJs: true },
				ts.sys,
			).resolvedModule?.resolvedFileName;
			if (!resolved || resolved.includes("/node_modules/")) {
				if (entry.fileName.startsWith("."))
					throw Error(`Unresolved migration source import: ${entry.fileName}`);
				continue;
			}
			const relative = path.relative(root, resolved);
			if (relative.startsWith("../") || !Object.hasOwn(source, relative))
				throw Error("Migration import outside accepted source");
			names.add(relative);
			imports.add(relative);
		}
	}
	const files = Object.fromEntries(
		[...names].sort().map((name) => {
			const digest = hash(regular(root, name));
			if (source[name] !== digest)
				throw Error(`Migration source changed during capture: ${name}`);
			return [name, digest];
		}),
	);
	return { files, migrations, scripts, lock: files["pnpm-lock.yaml"] };
}

// Serialized into one pinned Docker exec. stdin carries only the final authorization.
async function runtime(expected, deadline, commandDeadline, support) {
	const { path, hash, regular, members, spawn } = support;
	const root = path.resolve(process.cwd(), "../..");
	const inspect = () => {
		for (const [directory, names] of [
			["apps/asset/drizzle", expected.migrations],
			["apps/asset/scripts", expected.scripts],
		])
			if (JSON.stringify(members(root, directory)) !== JSON.stringify(names))
				return `membership:${directory}`;
		for (const [name, digest] of Object.entries(expected.files))
			if (hash(regular(root, name)) !== digest) return `hash:${name}`;
		if (
			regular(root, ".pnpm-lockfile-hash").toString().trim() !== expected.lock
		)
			return "installed-lock";
		return null;
	};
	let last;
	while (true) {
		try {
			last = inspect();
		} catch (error) {
			last = error.message;
		}
		if (!last) break;
		console.log(`asset-migration waiting ${last}`);
		if (Date.now() >= deadline)
			throw Error(`Asset migration delivery deadline exhausted: ${last}`);
		await new Promise((resolve) =>
			setTimeout(resolve, Math.min(50, deadline - Date.now())),
		);
	}
	console.log(`asset-migration verified ${hash(JSON.stringify(expected))}`);
	console.log("asset-migration ready");
	const authorization = await new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(Error("Asset migration authorization deadline exhausted")),
			Math.max(0, deadline - Date.now()),
		);
		process.stdin.setEncoding("utf8");
		process.stdin.once("data", (bytes) => {
			clearTimeout(timer);
			resolve(bytes.trim());
		});
		process.stdin.once("end", () => {
			clearTimeout(timer);
			reject(Error("Asset migration authorization lost"));
		});
	});
	if (authorization !== "launch" || Date.now() >= deadline)
		throw Error(
			"Asset migration source superseded or deadline exhausted; no launch",
		);
	const changed = inspect();
	if (changed) throw Error(`Asset migration changed before launch: ${changed}`);
	console.log(`asset-migration launch ${hash(JSON.stringify(expected))}`);
	process.stdin.pause();
	// Receipt is point in time. Source remains editable while the package owns SQL/backfill.
	const status = await new Promise((resolve, reject) => {
		const child = spawn("pnpm", ["run", "db:migrate"], {
			stdio: "inherit",
			env: process.env,
			detached: true,
		});
		let expired = false;
		const stop = (signal) => {
			try {
				process.kill(-child.pid, signal);
			} catch {}
		};
		const terminate = setTimeout(
			() => {
				expired = true;
				console.error(
					"Asset migration command deadline exhausted; termination requested, no automatic rerun",
				);
				stop("SIGTERM");
			},
			Math.max(0, commandDeadline - Date.now() - 1000),
		);
		const kill = setTimeout(
			() => stop("SIGKILL"),
			Math.max(0, commandDeadline - Date.now()),
		);
		child.on("error", (error) => {
			clearTimeout(terminate);
			clearTimeout(kill);
			reject(error);
		});
		child.on("close", (code) => {
			if (expired) stop("SIGKILL");
			clearTimeout(terminate);
			clearTimeout(kill);
			resolve(expired ? 1 : (code ?? 1));
		});
	});
	console.log(
		`asset-migration completed ${hash(JSON.stringify(expected))} ${status}`,
	);
	process.exitCode = status;
}

async function worker(requestFile, compose) {
	const request = JSON.parse(fs.readFileSync(requestFile));
	const deadline = Math.min(request.deadline, Date.now() + 20_000);
	const remaining = () => {
		const ms = deadline - Date.now();
		if (ms <= 0)
			throw Error("Asset migration delivery deadline exhausted; no launch");
		return ms;
	};
	const output = (command, args) =>
		execFileSync(command, args, {
			encoding: "utf8",
			timeout: remaining(),
			maxBuffer: 1024 * 1024,
		}).trim();
	// Compose selection and Docker inspection are bounded, read-only and never start an instance.
	const id = output(compose[0], [...compose.slice(1), "ps", "-q", "asset"]);
	if (!id || /\s/.test(id))
		throw Error("Asset migration requires one existing running container");
	const composeAt = compose.indexOf("compose");
	const docker = composeAt >= 0 ? compose.slice(0, composeAt) : ["docker"];
	const [info] = JSON.parse(
		output(docker[0], [...docker.slice(1), "inspect", id]),
	);
	if (
		!info?.State?.Running ||
		info.Config?.Labels?.["com.docker.compose.service"] !== "asset"
	)
		throw Error(
			"Asset migration requires existing running owned Asset instance",
		);
	const projectAt = compose.findIndex(
		(value) => value === "-p" || value === "--project-name",
	);
	const project =
		projectAt >= 0 ? compose[projectAt + 1] : process.env.COMPOSE_PROJECT_NAME;
	if (!project || info.Config.Labels["com.docker.compose.project"] !== project)
		throw Error("Asset migration container project mismatch");
	console.log(
		`asset-migration instance ${JSON.stringify({ id, project, service: "asset", cwd: "/app/apps/asset", deliveryDeadline: deadline, commandDeadline: request.deadline })}`,
	);
	const code = `import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {spawn} from 'node:child_process';const hash=${hash};const regular=${regular};const members=${members};await (${runtime})(${JSON.stringify(request.expected)},${deadline},${request.deadline},{fs,path,hash,regular,members,spawn}).catch(error=>{console.error(error.message);process.exitCode=1;process.stdin.destroy();});`;
	let waiting = true,
		sent = false;
	const status = await new Promise((resolve, reject) => {
		const child = spawn(
			docker[0],
			[
				...docker.slice(1),
				"exec",
				"-i",
				"-w",
				"/app/apps/asset",
				id,
				"node",
				"--input-type=module",
				"-e",
				code,
			],
			{ stdio: ["pipe", "pipe", "inherit"] },
		);
		child.stdin.on("error", () => {});
		let pending = "";
		child.stdout.on("data", (bytes) => {
			process.stdout.write(bytes);
			pending += bytes;
			if (pending.includes("asset-migration launch ")) waiting = false;
			pending = pending.slice(-4096);
		});
		let killer;
		const timer = setInterval(() => {
			if (!waiting) return;
			if (Date.now() >= deadline) {
				clearInterval(timer);
				sent = true;
				child.stdin.end("reject\n");
				child.kill("SIGTERM");
				killer = setTimeout(
					() => child.kill("SIGKILL"),
					Math.max(0, Math.min(1000, request.deadline - Date.now())),
				);
				return;
			}
			if (sent) return;
			if (fs.existsSync(request.permit)) {
				const permit = fs.readFileSync(request.permit, "utf8");
				sent = true;
				child.stdin.end(permit === request.token ? "launch\n" : "reject\n");
			}
		}, 20);
		child.on("error", (error) => {
			clearInterval(timer);
			clearTimeout(killer);
			reject(error);
		});
		child.on("close", (code) => {
			clearInterval(timer);
			clearTimeout(killer);
			resolve(code ?? 1);
		});
	});
	process.exitCode = status;
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	worker(process.argv[2], process.argv.slice(3)).catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
}

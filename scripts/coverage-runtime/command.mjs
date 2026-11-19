import { reportInput } from "./report-input.mjs";
import { checkoutIdentity } from "./artifacts.mjs";
// Maintained producer for the existing unit/integration report and CRAP contracts.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	closeSync,
	openSync,
	readFileSync,
	readlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import {
	cp,
	glob,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { coverageMap, publishReports } from "./publish-reports.mjs";
import { mergeReceipts, writeReceipt } from "./receipts.mjs";
import { auditReports } from "./report-audit.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url)),
	base = resolve(root, ".coverage-runtime/production");
const pointer = resolve(base, "latest.json"),
	sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
export async function verifySourceIdentity(path, sourceHashes) {
	const expected = sourceHashes[path];
	assert.ok(
		typeof expected === "string",
		`Missing compiled source identity: ${path}`,
	);
	assert.equal(
		sha(await readFile(path)),
		expected,
		`Coverage source changed since compilation: ${path}`,
	);
	return expected;
}
export async function clearAggregate(directory = resolve(root, "coverage")) {
	// The normal CRAP caller owns this lock through coverage and analysis.
	// Clearing a report must never release that caller's concurrency contract.
	await mkdir(directory, { recursive: true });
	for (const name of await readdir(directory))
		if (name !== ".crap-lock")
			await rm(resolve(directory, name), { recursive: true, force: true });
}
function environment(extra = {}) {
	const env = {
		...process.env,
		...extra,
		MAKEFLAGS: (process.env.MAKEFLAGS || "").split(" -- ")[0],
	};
	for (const key of [
		"MAKEOVERRIDES",
		"ARGS",
		"SCRIPT",
		"PACKAGE",
		"PACKAGES",
		"TURBO_FLAGS",
	])
		delete env[key];
	return env;
}
function make(args, extra = {}) {
	const stdio = ["inherit", "inherit", "inherit"],
		fd = Number(process.env.WALLPAPERDB_DOCKER_LEASE_FD);
	try {
		if (
			fd >= 3 &&
			readlinkSync(`/proc/self/fd/${fd}`) ===
				process.env.WALLPAPERDB_DOCKER_LEASE_FILE
		) {
			while (stdio.length <= fd) stdio.push("ignore");
			stdio[fd] = fd;
		}
	} catch {}
	const child = spawnSync("make", args, {
		cwd: root,
		env: environment(extra),
		stdio,
	});
	assert.equal(
		child.status,
		0,
		`Coverage command failed: make ${args.join(" ")} (${child.signal || child.status})`,
	);
}
function inside(workspace, path) {
	const rel = relative(resolve(root, workspace), path);
	assert.ok(
		rel && !rel.startsWith("..") && !isAbsolute(rel),
		`Coverage path is outside its workspace: ${path}`,
	);
}
async function main() {
	const args = process.argv.slice(2);
	let selected;
	for (let i = 0; i < args.length; i++) {
		assert.ok(
			["--package", "--packages"].includes(args[i]),
			`Unknown coverage argument: ${args[i]}`,
		);
		selected = args[++i]?.split(",");
		assert.ok(
			selected?.every((n) => /^[a-z0-9-]+$/.test(n)),
			"Select workspace short names",
		);
	}
	await mkdir(base, { recursive: true });
	const lock = base + "/producer.lock";
	try {
		const old = JSON.parse(readFileSync(lock, "utf8"));
		try {
			process.kill(old.pid, 0);
		} catch (error) {
			if (error.code === "ESRCH") unlinkSync(lock);
			else throw error;
		}
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	const handle = openSync(lock, "wx");
	writeFileSync(handle, JSON.stringify({ pid: process.pid }));
	closeSync(handle);
	const initialIdentity = checkoutIdentity(root);
	const attempt = await mkdtemp(base + "/attempt-");
	let outputs = [];
	await writeFile(pointer, JSON.stringify({ status: "running", attempt }));
	try {
		make(["run", "PACKAGE=scripts", "SCRIPT=coverage:inventory"], {
			WALLPAPERDB_COVERAGE_REPO_OUTPUT_ROOT: attempt,
		});
		const inventory = await json(attempt + "/matrix.json");
		const rows = inventory.tiers.filter(
			(r) =>
				["test:unit", "test:integration"].includes(r.script) &&
				(!selected ||
					selected.includes(
						r.workspace === "."
							? "root"
							: r.workspace === "infra"
								? "infra-local"
								: r.workspace.split("/").at(-1),
					)),
		);
		const shard = process.env.CI_WORKSPACE_FILTER;
		if (shard) {
			assert.ok(
				["@wallpaperdb/factory", "!@wallpaperdb/factory"].includes(shard),
				"Unsupported CI shard",
			);
			for (let i = rows.length - 1; i >= 0; i--)
				if (
					(rows[i].workspace === "apps/factory") !==
					(shard === "@wallpaperdb/factory")
				)
					rows.splice(i, 1);
		}
		assert.ok(rows.length, "No unit/integration coverage producers selected");
		for (const name of selected || [])
			assert.ok(
				rows.some(
					(row) =>
						(row.workspace === "."
							? "root"
							: row.workspace === "infra"
								? "infra-local"
								: row.workspace.split("/").at(-1)) === name,
				),
				`No unit/integration coverage producer for ${name}`,
			);

		const workspaces = [...new Set(rows.map((r) => r.workspace))];
		outputs = workspaces.flatMap((workspace) =>
			["unit", "integration"].map((tier) =>
				resolve(root, workspace, "coverage", tier),
			),
		);
		const manifest = {
			attempt,
			status: "running",
			workspaces,
			outputs: [],
			sourceHashes: {},
			audit: [],
			scope:
				"all selected configured unit/integration tests, including noncoverage tiers",
		};
		// Clear declared outputs before work starts. A failed generation cannot
		// expose a previous success to CRAP, merge or coverage-summary.
		for (const workspace of workspaces)
			for (const tier of ["unit", "integration"])
				await rm(resolve(root, workspace, "coverage", tier), {
					recursive: true,
					force: true,
				});
		await clearAggregate();
		const filters = workspaces
			.map((w) =>
				w === "."
					? "--filter=//"
					: `--filter=@wallpaperdb/${w === "infra" ? "infra-local" : w.split("/").at(-1)}...`,
			)
			.join(" ");
		make(["build", `TURBO_FLAGS=${filters} --concurrency=1`]);
		make(["run", "PACKAGE=scripts", "SCRIPT=coverage:build"]);
		const compiledSourceHashes = await json(
			resolve(root, ".coverage-runtime/build/source-hashes.json"),
		);
		const produced = [],
			nonproducers = [];
		for (const row of rows) {
			const command = [
				"run",
				"PACKAGE=scripts",
				"SCRIPT=coverage:tier",
				`ARGS=${row.id}`,
			];
			make(
				row.containers
					? [
							"docker-run",
							`ARGS=make run PACKAGE=scripts SCRIPT=coverage:tier ARGS="${row.id}"`,
						]
					: command,
				{ WALLPAPERDB_COVERAGE_REPO_OUTPUT_ROOT: attempt },
			);
			const latest = await json(
					`${attempt}/runs/${row.id}/candidate/latest.json`,
				),
				directory = latest.directory;
			const exit = await json(directory + "/exit.json");
			assert.equal(exit.code, 0);
			assert.equal(
				exit.implementationChangedDuringRun,
				false,
				"Tooling changed during coverage run",
			);
			const tests = await json(directory + "/tests.json");
			assert.equal(tests.success, true, "Test report did not pass");
			if (!row.coverage) {
				nonproducers.push(row);
				continue;
			}
			const selection = await json(directory + "/selection.json"),
				rawPath = directory + "/coverage/coverage-final.json",
				rawData = await json(rawPath);
			const { original: data, generated } = await reportInput(
				rawData,
				root,
				row.workspace,
			);
			for (const [path, file] of Object.entries(data)) {
				inside(row.workspace, path);
				assert.equal(file.path, path);
				manifest.sourceHashes[path] = await verifySourceIdentity(
					path,
					compiledSourceHashes,
				);
			}
			for (const pattern of selection.originalCoverage?.include || []) {
				const excluded = new Set();
				for (const p of selection.originalCoverage.exclude || [])
					for await (const f of glob(p, { cwd: resolve(root, row.runtime) }))
						excluded.add(f);
				for await (const file of glob(pattern, {
					cwd: resolve(root, row.runtime),
				}))
					if (!excluded.has(file))
						assert.ok(
							data[resolve(root, row.runtime, file)],
							`Missing original coverage source: ${file}`,
						);
			}
			const override = row.args
				.find((a) => a.startsWith("--coverage.reportsDirectory="))
				?.split("=")
				.slice(1)
				.join("=");
			const reports =
				override || selection.originalCoverage?.reportsDirectory || "coverage";
			const cwd = resolve(
				root,
				row.strategy === "compiled-native" ? ".coverage-runtime/build" : "",
				row.runtime,
			);
			const destination = resolve(
				root,
				row.runtime,
				relative(cwd, resolve(cwd, reports)),
			);
			inside(row.workspace, destination);
			assert.ok(
				relative(
					resolve(root, row.workspace, "coverage"),
					destination,
				).startsWith("..") === false,
				"Unexpected report destination",
			);
			produced.push({
				id: row.id,
				data,
				rawData,
				generated,
				row,
				rawPath,
				destination,
			});
		}
		assert.equal(
			checkoutIdentity(root),
			initialIdentity,
			"Checkout changed during coverage generation",
		);
		const audited = auditReports(
			produced.map(({ id, data }) => ({ id, data })),
			root,
		);
		manifest.audit = audited.audit;
		for (let i = 0; i < produced.length; i++) {
			const item = produced[i],
				data = audited.reports[i].data,
				stage = resolve(attempt, "published", item.id);
			await publishReports(data, stage);
			await writeFile(
				stage + "/coverage-audit.json",
				JSON.stringify(
					{
						rawReport: item.rawPath,
						rawSHA256: sha(await readFile(item.rawPath)),
						entries: manifest.audit.filter((a) => a.report === item.id),
					},
					null,
					2,
				),
			);
			item.stage = stage;
		}
		// Publish only after every test, inventory, audit and renderer succeeded.
		for (const item of produced) {
			await cp(item.stage, item.destination, { recursive: true });
			const path = item.destination + "/coverage-final.json";
			manifest.outputs.push({
				id: item.id,
				workspace: item.row.workspace,
				path,
				sha256: sha(await readFile(path)),
				rawReport: item.rawPath,
			});
		}
		manifest.status = "success";
		const path = attempt + "/manifest.json";
		await writeFile(path, JSON.stringify(manifest, null, 2));
		await writeFile(
			pointer,
			JSON.stringify({ status: "success", attempt, manifest: path }),
		);
		for (const row of nonproducers)
			await writeReceipt(
				resolve(root, "coverage/receipts"),
				root,
				row,
				null,
				null,
				{},
				[],
			);
		for (let i = 0; i < produced.length; i++) {
			const item = produced[i];
			const identities = Object.fromEntries(
				Object.keys(item.data).map((path) => [
					path,
					manifest.sourceHashes[path],
				]),
			);
			await writeReceipt(
				resolve(root, "coverage/receipts"),
				root,
				item.row,
				item.rawData,
				audited.reports[i].data,
				identities,
				manifest.audit.filter((a) => a.report === item.id),
				item.generated,
			);
		}
		await mergeReceipts(root, rows);
		const estimated = manifest.audit.filter(
			(entry) => entry.published === 1,
		).length;
		console.error(
			`Compiled coverage: ${workspaces.join(", ")}; ${rows.length} reports; ${manifest.audit.length}/2 audited branch arms (${estimated} estimated-covered, ${manifest.audit.length - estimated} conservatively uncovered). Audit: ${path}`,
		);
	} catch (error) {
		for (const output of outputs)
			await rm(output, { recursive: true, force: true });
		await clearAggregate();
		await writeFile(
			pointer,
			JSON.stringify({ status: "failed", attempt, error: error.message }),
		);
		throw error;
	} finally {
		unlinkSync(lock);
	}
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();

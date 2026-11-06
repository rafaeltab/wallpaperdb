import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import {
	assessAssetBaseline,
	assessBaselineAssertions,
	refuseTestSetup,
} from "./boat-547-baseline.mjs";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const dataPath = new URL(
	"../boat-workloads/547-preparation.json",
	import.meta.url,
);
const data = read(dataPath);
const workload = read(new URL("../boat-workloads/547.json", import.meta.url));
const asset = read(
	new URL("../boat-workloads/547-asset-baseline.json", import.meta.url),
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const require = (condition, reason) => {
	if (!condition) throw new Error(reason);
};
const text = (bytes) =>
	stripVTControlCharacters(
		new TextDecoder("utf-8", { fatal: true }).decode(bytes),
	);
const git = (...args) =>
	execFileSync("git", args, { cwd: repository, maxBuffer: 16 * 1024 * 1024 });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const exists = (file) =>
	fs.lstatSync(file, { throwIfNoEntry: false }) !== undefined;

export function markedObservation(raw, marker) {
	const lines = text(raw.stdout)
		.split("\n")
		.filter((line) => line.startsWith(`${marker} `));
	require(lines.length === 1, `Expected one ${marker} observation`);
	return JSON.parse(lines[0].slice(marker.length + 1));
}

function assessTests(raw, phase) {
	if (phase === "red-asset")
		return assessAssetBaseline(raw.stdout, raw.stderr, asset);
	const green = phase.startsWith("green-");
	const baseline = phase.replace(/^green-/, "red-");
	const contract =
		baseline === "red-asset"
			? {
					collected: 18,
					failed: 16,
					files: Array.from(
						new Set(asset.expectedCaseSet.map((c) => c.file)),
					).map((file) => ({ file, project: "asset-integration" })),
				}
			: data.baselines[baseline];
	const out = text(raw.stdout),
		err = text(raw.stderr);
	refuseTestSetup(
		out,
		err,
		baseline === "red-auth"
			? [
					"test/protected-broker.integration.test.ts",
					"test/broker-acquisition-errors.integration.test.ts",
				]
			: ["test/broker-acquisition"],
	);
	const headers = [
		...out.matchAll(
			/^\s*[❯✓]\s+(\S+)\s+(test\/[^\s]+\.ts)\s+\((\d+) tests?(?: \| (\d+) failed)?\)/gm,
		),
	].map((m) => ({
		project: m[1],
		file: m[2],
		collected: Number(m[3]),
		failed: Number(m[4] ?? 0),
	}));
	require(headers.length === contract.files.length &&
		new Set(headers.map((h) => h.file)).size === headers.length &&
		headers.every((h) =>
			contract.files.some((f) => f.project === h.project && f.file === h.file),
		), "CASE_SET");
	const failed = green ? 0 : contract.failed;
	require(headers.reduce((n, h) => n + h.collected, 0) === contract.collected &&
		headers.reduce((n, h) => n + h.failed, 0) === failed, "CASE_COUNTS");
	const summary = out.match(/^\s*Tests\s+(.+?)\s+\((\d+)\)\s*$/m);
	require(summary &&
		Number(summary[2]) === contract.collected &&
		Number(summary[1].match(/(\d+) failed/)?.[1] ?? 0) === failed &&
		Number(summary[1].match(/(\d+) passed/)?.[1] ?? 0) ===
			contract.collected - failed, "TEST_SUMMARY");
	if (!green) {
		let file;
		const observed = [];
		for (const line of out.split("\n")) {
			const header = line.match(/^\s*[❯✓]\s+\S+\s+(test\/[^\s]+\.ts)\s+\(/);
			if (header) file = header[1];
			const entry = line.match(/^\s*([✓×])\s+(.+?)\s+\d+(?:\.\d+)?m?s\s*$/);
			if (entry)
				observed.push([file, entry[2], entry[1] === "×" ? "failed" : "passed"]);
		}
		require(same(
			observed.sort(),
			contract.cases.map((c) => [c.file, c.name, c.result]).sort(),
		), "CASE_OUTCOME");
		assessBaselineAssertions(
			err,
			contract.cases.map((c) => ({ ...c, assertionAnchor: contract.anchor })),
		);
	}
	return {
		collected: contract.collected,
		failed,
		passed: contract.collected - failed,
	};
}

function approvedLock(initial) {
	const lines = initial.toString("utf8").match(/[^\n]*\n|[^\n]+$/g);
	const changes = [];
	for (const edit of data.lock.edits) {
		const starts = lines.flatMap((line, i) =>
			line === edit.section ? [i] : [],
		);
		require(starts.length === 1, "Lock section is ambiguous");
		let start = starts[0],
			end = lines.findIndex((line, i) => i > start && /^\S/.test(line));
		if (end < 0) end = lines.length;
		if (edit.owner !== null) {
			const owners = lines.flatMap((line, i) =>
				i > start && i < end && line === edit.owner ? [i] : [],
			);
			require(owners.length === 1, "Lock owner is ambiguous");
			start = owners[0];
			const next = lines.findIndex(
				(line, i) => i > start && i < end && /^ {2}\S/.test(line),
			);
			if (next >= 0) end = next;
		}
		const positions = [];
		for (let i = start; i < end; i++)
			if (
				edit.before.length
					? same(lines.slice(i, i + edit.before.length), edit.before)
					: lines[i - 1] === edit.anchorBefore && lines[i] === edit.anchorAfter
			)
				positions.push(i);
		require(positions.length ===
			1, "Approved lock location is missing or ambiguous");
		changes.push({
			at: positions[0],
			count: edit.before.length,
			after: edit.after,
		});
	}
	const occupied = new Set();
	for (const c of changes)
		for (let i = c.at; i < c.at + Math.max(1, c.count); i++) {
			require(!occupied.has(i), "Overlapping lock edits");
			occupied.add(i);
		}
	for (const c of changes.sort((a, b) => b.at - a.at))
		lines.splice(c.at, c.count, ...c.after);
	return Buffer.from(lines.join(""));
}

const environmentRecipes = [
	"asset",
	"color-extractor",
	"gateway",
	"ingestor",
	"tags",
	"user",
	"variant-generator",
	"wallpaper",
	"web",
].map((application) => `apps/${application}/Dockerfile.dev`);

const gitTree = (revision, ...paths) =>
	git("ls-tree", "-r", revision, "--", ...paths)
		.toString("utf8")
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const [mode, , blob, file] = line.split(/\s+/);
			return { mode, blob, path: file };
		});

const nativeObjects = {
	baselineApps: () => gitTree(workload.productBase, "apps"),
	infrastructure: () => {
		const revision = git("rev-parse", "--verify", "HEAD^{commit}")
			.toString("utf8")
			.trim();
		return { revision, recipes: gitTree(revision, ...environmentRecipes) };
	},
	baselineBlob: (file) => {
		const result = git("ls-tree", workload.productBase, "--", file)
			.toString("utf8")
			.trim();
		return result ? result.split(/\s+/)[2] : null;
	},
	readBlob: (blob) => git("cat-file", "blob", blob),
};

export function create547Preparation(root, objects = nativeObjects) {
	const initialLock = fs.readFileSync(
		path.join(root, workload.inputs.initialLock.path),
	);
	require(sha(initialLock) ===
		workload.inputs.initialLock.sha256, "Frozen initial lock changed");
	const productTree = objects.baselineApps();
	const infrastructure = objects.infrastructure();
	require(/^[a-f0-9]{40}$/.test(infrastructure.revision) &&
		same(
			infrastructure.recipes.map((item) => item.path).sort(),
			[...environmentRecipes].sort(),
		), "Selected infrastructure recipe authority differs");
	const tree = new Map(productTree.map((item) => [item.path, item]));
	for (const recipe of infrastructure.recipes) {
		require(tree.has(recipe.path) &&
			["100644", "100755"].includes(
				recipe.mode,
			), "Infrastructure recipe is not an existing regular Git file");
		tree.set(recipe.path, recipe);
	}
	const expected = new Map();
	const modes = new Map();
	for (const item of tree.values()) {
		const stat = fs.lstatSync(path.join(root, item.path));
		require(stat.isFile(), `Product baseline is not a regular file: ${item.path}`);
		const bytes = fs.readFileSync(path.join(root, item.path));
		require(createHash("sha1")
			.update(`blob ${bytes.length}\0`)
			.update(bytes)
			.digest("hex") === item.blob, `Product baseline changed: ${item.path}`);
		require(((stat.mode & 0o111) !== 0) ===
			(item.mode ===
				"100755"), `Product executable mode changed: ${item.path}`);
		expected.set(item.path, sha(bytes));
		modes.set(item.path, stat.mode & 0o777);
	}
	for (const input of [
		workload.inputs.initialLock,
		workload.inputs.unchangedProtectedControl,
	])
		require(sha(fs.readFileSync(path.join(root, input.path))) ===
			input.sha256, `Frozen input changed: ${input.path}`);
	const selected = new Set([
		workload.inputs.initialLock.path,
		workload.inputs.unchangedProtectedControl.path,
		...environmentRecipes,
	]);
	for (const file of [
		"apps/web/src/boat-547-presence.txt",
		...workload.live.fixtures.map((f) => f.destination),
		...["user", "wallpaper", "asset"].map(
			(name) => `apps/${name}/src/boat-sdk-proof-547.ts`,
		),
	]) {
		require(!exists(
			path.join(root, file),
		), `Unexpected later-phase input: ${file}`);
		expected.set(file, null);
		selected.add(file);
	}
	const baseline = new Map(productTree.map((item) => [item.path, item.blob]));
	for (const input of [...workload.inputs.tests, ...workload.inputs.repair]) {
		const blob = baseline.get(input.path) ?? objects.baselineBlob(input.path);
		const before = blob ? objects.readBlob(blob) : null;
		require(before
			? fs.existsSync(path.join(root, input.path)) &&
					fs.readFileSync(path.join(root, input.path)).equals(before)
			: !exists(
					path.join(root, input.path),
				), `Disposable baseline changed: ${input.path}`);
		expected.set(input.path, before ? sha(before) : null);
		selected.add(input.path);
	}
	expected.set(workload.inputs.initialLock.path, sha(initialLock));
	for (const file of selected)
		if (expected.get(file) !== null)
			modes.set(file, fs.lstatSync(path.join(root, file)).mode & 0o777);
	const verify = (all = false, except) => {
		for (const file of all ? expected.keys() : selected) {
			if (file === except) continue;
			const absolute = path.join(root, file),
				hash = expected.get(file);
			if (hash === null) {
				require(!exists(absolute), `Unexpected disposable input: ${file}`);
				continue;
			}
			require(fs.lstatSync(absolute).isFile() &&
				(fs.lstatSync(absolute).mode & 0o777) === modes.get(file) &&
				sha(fs.readFileSync(absolute)) ===
					hash, `Frozen workload changed: ${file}`);
		}
	};
	const stage = (inputs) => {
		verify();
		// Validate the complete group before its first owned write.
		const payloads = inputs.map((input) => {
			const bytes = input.source
				? (objects.readLiveFile ?? fs.readFileSync)(input.source)
				: objects.readBlob(input.gitBlob);
			require(sha(bytes) ===
				input.sha256, `Frozen blob changed: ${input.path}`);
			return { input, bytes };
		});
		for (const { input, bytes } of payloads) {
			const file = path.join(root, input.path),
				old = expected.get(input.path);
			fs.mkdirSync(path.dirname(file), { recursive: true });
			const fd = fs.openSync(file, old === null ? "wx" : "r+", 0o600);
			try {
				const stat = fs.fstatSync(fd),
					current = fs.lstatSync(file);
				require(stat.isFile() &&
					current.isFile() &&
					stat.ino === current.ino &&
					stat.dev === current.dev &&
					(old === null ||
						sha(fs.readFileSync(fd)) ===
							old), `Staging ownership changed: ${input.path}`);
				let written = 0;
				while (written < bytes.length)
					written += fs.writeSync(
						fd,
						bytes,
						written,
						bytes.length - written,
						written,
					);
				fs.ftruncateSync(fd, bytes.length);
				fs.fsyncSync(fd);
			} finally {
				fs.closeSync(fd);
			}
			expected.set(input.path, input.sha256);
			modes.set(input.path, fs.lstatSync(file).mode & 0o777);
		}
		verify();
	};
	let generated;
	let metadata;
	return {
		infrastructure,
		browserSourceInputs(kind) {
			const files = {
				heading: "apps/web/src/routes/upload.tsx",
				presence: "apps/web/src/boat-547-presence.txt",
			};
			require(Object.hasOwn(files, kind), "Unknown #547 browser source");
			const file = files[kind],
				absolute = path.join(root, file);
			verify(true, file);
			const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
			if (stat)
				require(stat.isFile() &&
					!stat.isSymbolicLink() &&
					(stat.mode & 0o777) ===
						(modes.get(file) ??
							0o600), "Browser source mode or regular-file ownership changed");
			return [
				...new Set(
					[...selected]
						.filter((name) => expected.get(name) !== null)
						.map((name) => path.join(root, name))
						.concat(stat ? [absolute] : []),
				),
			];
		},
		inputs: () => {
			verify();
			return [...selected]
				.filter((file) => expected.get(file) !== null)
				.map((file) => path.join(root, file));
		},
		verify,
		stageTests: () => stage(workload.inputs.tests),
		stageRepair: () => stage(workload.inputs.repair),
		stageSdk() {
			const proof = workload.live.fixtures.find((f) =>
				f.destination.endsWith("remediation-sdk-proof.ts"),
			);
			stage([
				...workload.live.fixtures.map((f) => ({
					path: f.destination,
					source: f.stagedSource,
					sha256: f.stagedSha256,
				})),
				...["user", "wallpaper", "asset"].map((name) => ({
					path: `apps/${name}/src/boat-sdk-proof-547.ts`,
					source: proof.stagedSource,
					sha256: proof.stagedSha256,
				})),
			]);
		},
		assessTests,
		initialLock,
		acceptGenerated(directory) {
			generated = fs.readFileSync(path.join(root, "pnpm-lock.yaml"));
			require(generated.equals(approvedLock(initialLock)) &&
				!generated.equals(
					initialLock,
				), "Complete generated lock differs from approved location changes");
			fs.writeFileSync(path.join(directory, "initial-lock.yaml"), initialLock, {
				flag: "wx",
				mode: 0o600,
			});
			fs.writeFileSync(path.join(directory, "returned-lock.yaml"), generated, {
				flag: "wx",
				mode: 0o600,
			});
			let diff;
			try {
				diff = execFileSync(
					"git",
					[
						"diff",
						"--no-index",
						"--no-ext-diff",
						"--",
						path.join(directory, "initial-lock.yaml"),
						path.join(directory, "returned-lock.yaml"),
					],
					{ timeout: 5000 },
				);
			} catch (error) {
				if (error.status !== 1) throw error;
				diff = error.stdout;
			}
			fs.writeFileSync(path.join(directory, "lock.diff"), diff, {
				flag: "wx",
				mode: 0o600,
			});
			expected.set("pnpm-lock.yaml", sha(generated));
			return {
				lockVersion: data.lock.version,
				approvedChanges: data.lock.counts,
				bytes: generated.length,
				sha256: sha(generated),
			};
		},
		acceptNoop() {
			require(fs
				.readFileSync(path.join(root, "pnpm-lock.yaml"))
				.equals(generated), "Noop generator changed lock bytes");
			return { unchanged: true, sha256: sha(generated) };
		},
		acceptMetadata(raw) {
			metadata = markedObservation(raw, "BOAT547_WORKER_METADATA");
			require(metadata.playwrightVersion === "1.59.1" &&
				metadata.browsers?.length === 2 &&
				metadata.browsers.every(
					(b) => b.revision === "1217" && b.browserVersion === "147.0.7727.15",
				) &&
				metadata.sdk?.patchSha256 === workload.loadedRuntime.patchSha256 &&
				metadata.sdk?.protocolSha256 ===
					workload.loadedRuntime.protocolSha256 &&
				metadata.sdk?.transportSha256 ===
					workload.loadedRuntime.transportSha256 &&
				metadata.rootLock?.sha256 === sha(generated) &&
				same(
					metadata.rootLock.natsConsumers,
					metadata.installedLock?.natsConsumers,
				) &&
				metadata.rootLock.natsConsumers?.length === 13 &&
				metadata.rootLock.natsPatch?.hash ===
					workload.loadedRuntime.patchSha256 &&
				metadata.installedLock?.natsPatch?.hash ===
					workload.loadedRuntime
						.patchSha256, "Installed runtime metadata mismatch");
			return metadata;
		},
		acceptChromium(raw) {
			const observed = markedObservation(raw, "BOAT547_CHROMIUM_LAUNCH");
			require(observed.closed === true &&
				observed.regular === true &&
				observed.executableAccess === true &&
				observed.headless === true &&
				observed.playwrightVersion === metadata.playwrightVersion &&
				observed.playwrightPath === metadata.playwrightPath &&
				observed.executable === metadata.chromiumExecutable &&
				observed.browserVersion === "147.0.7727.15" &&
				observed.user === metadata.user &&
				observed.home === metadata.home &&
				observed.playwrightBrowsersPath ===
					metadata.playwrightBrowsersPath, "Actual Chromium launch identity mismatch");
			return observed;
		},
		acceptImages(raw, project) {
			const observed = markedObservation(raw, "BOAT_INFRA_IMAGES");
			require(observed.project === project &&
				observed.images?.length === 8 &&
				same(
					observed.images.map((i) => i.reference).sort(),
					[...data.defaultImages].sort(),
				) &&
				observed.images.every((i) =>
					/^sha256:[a-f0-9]{64}$/.test(i.id),
				), "Default image acquisition proof mismatch");
			return observed;
		},
	};
}

export const preparationInputs = [
	fileURLToPath(import.meta.url),
	fileURLToPath(dataPath),
	fileURLToPath(new URL("../boat-workloads/547-runtime.cjs", import.meta.url)),
];
export const qualifiedCliSha256 = data.cliSha256;

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { quote } from "./boat.mjs";
import { markedObservation } from "./boat-547-preparation.mjs";

const source = fileURLToPath(import.meta.url);
const observer = fileURLToPath(
	new URL("../boat-preview-observation.py", import.meta.url),
);
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const require = (condition, reason) => {
	if (!condition) throw new Error(reason);
};
const routes = [
	"/web/",
	"/ingestor/ready",
	"/asset/ready",
	"/wallpaper/ready",
	"/gateway/ready",
	"/variant-generator/ready",
	"/color-extractor/ready",
	"/user/ready",
];
const services = [
	"asset",
	"caddy",
	"color-extractor",
	"gateway",
	"ingestor",
	"tags",
	"user",
	"variant-generator",
	"wallpaper",
	"web",
];
function jsonLines(raw, mode) {
	const observation = markedObservation(raw, "BOAT547_APPLICATION");
	require(observation.mode === mode &&
		typeof observation.nativeStdout ===
			"string", "Application observation mode differs");
	const bytes = Buffer.from(observation.nativeStdout, "base64");
	require(bytes.toString("base64") ===
		observation.nativeStdout, "Application observation encoding differs");
	return bytes
		.toString("utf8")
		.split("\n")
		.filter((line) => line.trim())
		.map(JSON.parse);
}

function containers(raw, selected, project) {
	const rows = JSON.parse(raw.stdout.toString("utf8"));
	require(Array.isArray(rows) &&
		rows.length ===
			services.length, "Required container inspection count differs");
	return services.map((service) => {
		const matches = rows.filter(
			(row) => row.labels?.["com.docker.compose.service"] === service,
		);
		require(matches.length ===
			1, `Required inspected service differs: ${service}`);
		const row = matches[0],
			record = selected.find((s) => s.Service === service);
		require(/^[a-f0-9]{64}$/.test(row.id) &&
			row.id.startsWith(record.ID) &&
			/^sha256:[a-f0-9]{64}$/.test(row.image) &&
			row.labels["com.docker.compose.project"] === project &&
			row.state?.Running === true &&
			row.state.Status === "running" &&
			Number.isSafeInteger(row.state.Pid) &&
			row.state.Pid > 0 &&
			Number.isFinite(Date.parse(row.state.StartedAt)) &&
			Number.isFinite(Date.parse(row.created)) &&
			Number.isSafeInteger(row.restartCount) &&
			row.restartCount >= 0, `Required container identity differs: ${service}`);
		return { service, ...row };
	});
}

function launcher(pid, root) {
	const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
	const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
	require(fields[0] !== "Z" &&
		fs.readlinkSync(`/proc/${pid}/cwd`) ===
			root, "Serving launcher is not live in owning worktree");
	return {
		pid,
		birth: fields[19],
		group: Number(fields[2]),
		session: Number(fields[3]),
		cwd: root,
	};
}

// This is the #547 continuation of the shared executor, not another lifecycle
// controller. Normal Make owns projection, Watch, preview and worker shutdown.
export async function start547Application(context) {
	const {
		config,
		binding,
		workload,
		preservedImplementation,
		cleanup,
		make,
		clock,
		publication,
		publish,
		manifest,
		fileIdentity,
		runPhase,
	} = context;
	const root = config.worktree,
		directory = path.join(config.evidence, "startup");
	const started = clock(),
		deadline = started + 600;
	const result = {
		version: 1,
		round: config.round,
		phase: "startup",
		owner: binding,
		started,
		deadline,
		compute: "OPEN",
	};
	const handles = [];
	let acquired = false;
	let cleanupPromise;
	const retire = () => {
		cleanupPromise ??= (async () => {
			const captures = await Promise.allSettled(handles.map((h) => h.stop()));
			const transports = captures.map((r) =>
				r.status === "fulfilled" ? r.value : { failure: r.reason.message },
			);
			const stopped = await cleanup();
			const drained = handles.every((h) => {
				try {
					const d = read(path.join(h.checkpointDirectory, "disposal.json"));
					return (
						d.pipesClosed &&
						d.unresolved?.length === 0 &&
						(!d.failure || d.failure === "deadline exceeded")
					);
				} catch {
					return false;
				}
			});
			const value = {
				...stopped,
				status: drained ? stopped.status : "UNRESOLVED_LOCAL_TRANSPORT",
				compute: stopped,
				transports,
			};
			publish(
				acquired
					? path.join(directory, "cleanup.json")
					: path.join(config.evidence, "startup-cleanup.json"),
				value,
			);
			return value;
		})();
		return cleanupPromise;
	};
	const within = () => {
		require(clock() <
			deadline, "Original startup deadline exceeded before acceptance");
		for (const handle of handles) handle.assertRunning();
	};
	const inputs = () => {
		preservedImplementation();
		workload.verify(true);
		return [
			...workload.inputs(),
			source,
			observer,
			path.join(root, ".worktree"),
			path.join(root, "Makefile"),
		];
	};
	const fixed = [source, observer].map(fileIdentity);
	const preserved = () => {
		inputs();
		require(JSON.stringify(fixed) ===
			JSON.stringify(
				[source, observer].map(fileIdentity),
			), "Startup implementation changed");
		const state = read(path.join(root, ".boat/state.json"));
		require(state.id === binding.worker &&
			state.runningSince != null &&
			state.admission?.token === binding.admission &&
			state.admission.status === "published" &&
			state.admission.owner?.root === root &&
			state.admission.owner.key === binding.key &&
			state.admission.candidate?.id ===
				binding.worker, "Startup worker/admission ownership changed");
	};
	const run = async (
		id,
		argv,
		assess = () => ({ completed: true }),
		prepare,
	) => {
		within();
		const phase = await runPhase(
			{ id, argv, inputs, assess, prepare },
			deadline,
			retire,
		);
		within();
		return phase.outcome;
	};
	const wait = async (predicate, usable) => {
		const until = Math.min(deadline, clock() + usable);
		for (;;) {
			within();
			require(clock() < until, "Serving readiness deadline exceeded");
			const value = predicate();
			if (value) return value;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
	};
	const launch = async (name, argv) => {
		within();
		preserved();
		const handle = await make(argv, {
			cwd: root,
			directory: path.join(directory, name),
			serving: true,
		});
		handles.push(handle);
		within();
		return handle;
	};
	try {
		fs.mkdirSync(directory, { mode: 0o700 });
		acquired = true;
		preserved();
		within();
		require(/^[A-Za-z0-9_-]+$/.test(
			binding.project,
		), "Invalid generated Compose project");
		require(!fs.existsSync(
			path.join(root, ".boat/preview-process.json"),
		), "Startup found an existing preview owner; no replacement authorized");
		await run(
			"infra-start",
			["make", "infra-start", "ARGS=--pull=never"],
			undefined,
			workload.stageSdk,
		);
		const dev = await launch("dev", ["make", "dev"]);
		await wait(
			() =>
				fs
					.readFileSync(path.join(directory, "dev/stdout.raw"), "utf8")
					.includes("Watch enabled"),
			60,
		);
		const preview = await launch("preview", ["make", "boat-preview"]);
		const current = await wait(() => {
			const file = path.join(root, ".boat/preview-process.json");
			if (!fs.existsSync(file)) return false;
			const value = read(file);
			return value.ready === true && value.phase === "ready" && value;
		}, 175);
		require(typeof current.generation === "string" &&
			current.generation &&
			current.forward?.startTicks &&
			current.cwd === root, "Published preview identity is incomplete");
		const observations = await Promise.allSettled(
			routes.map(async (route) => {
				const response = await fetch(
					`http://127.0.0.1:${binding.ingress}${route}`,
					{ redirect: "error", signal: AbortSignal.timeout(5000) },
				);
				const digest = createHash("sha256");
				let bytes = 0;
				for await (const chunk of response.body) {
					bytes += chunk.length;
					require(bytes <= 16777216, `Readiness response overflow: ${route}`);
					digest.update(chunk);
				}
				return {
					path: route,
					status: response.status,
					bytes,
					sha256: digest.digest("hex"),
					completedAt: clock(),
				};
			}),
		);
		publish(
			path.join(directory, "routes.json"),
			observations.map((r) =>
				r.status === "fulfilled" ? r.value : { error: r.reason.message },
			),
		);
		result.routes = observations.map((r) => {
			if (r.status === "rejected") throw r.reason;
			require(r.value.status ===
				200, `Readiness route failed: ${r.value.path}`);
			return r.value;
		});
		within();
		let selected;
		await run(
			"app-inventory",
			[
				"make",
				"docker-run",
				`ARGS=node scripts/boat-workloads/547-runtime.cjs application-ps ${binding.project}`,
			],
			(raw) => {
				const parsed = jsonLines(raw, "application-ps");
				const rows = Array.isArray(parsed[0]) ? parsed.flat() : parsed;
				selected = rows.filter((r) => services.includes(r.Service));
				require(selected.length === 10 &&
					services.every(
						(s) => selected.filter((r) => r.Service === s).length === 1,
					) &&
					selected.every(
						(r) =>
							r.Project === binding.project &&
							r.State === "running" &&
							/^[a-f0-9]{12,64}$/.test(r.ID),
					), "Required ten app/Caddy services differ");
				return selected;
			},
		);
		result.containers = await run(
			"app-identities",
			[
				"make",
				"docker-run",
				`ARGS=node scripts/boat-workloads/547-runtime.cjs application-inspect ${selected.map((r) => r.ID).join(" ")}`,
			],
			(raw) =>
				containers(
					{
						stdout: Buffer.from(
							JSON.stringify(jsonLines(raw, "application-inspect")),
						),
					},
					selected,
					binding.project,
				),
		);
		const observation = path.join(directory, "preview-observation-input.json");
		publish(observation, {
			oldPreview: current,
			devLauncher: launcher(dev.pid, root),
			root,
			ports: [binding.ingress, binding.ingress + 20000],
		});
		result.ownership = await run(
			"preview-ownership",
			[
				"make",
				"run",
				"BOAT_EXEC=local",
				"PACKAGE=scripts",
				"SCRIPT=boat:observe-preview",
				`ARGS=${quote(observation)}`,
			],
			(raw) => markedObservation(raw, "BOAT547_PREVIEW_OBSERVATION"),
		);
		preserved();
		within();
		const latest = read(path.join(root, ".boat/preview-process.json"));
		require(latest.ready === true &&
			latest.generation === current.generation &&
			latest.pid === current.pid &&
			latest.startTicks === current.startTicks &&
			JSON.stringify(latest.forward) ===
				JSON.stringify(
					current.forward,
				), "Preview identity changed during readiness acceptance");
		Object.assign(result, {
			status: "PASS_STARTUP_READY",
			url: `http://localhost:${binding.ingress}/web/`,
			preview: current,
			dev: dev.checkpoint(),
			previewCapture: preview.checkpoint(),
			acceptedAt: clock(),
			next: "ROOT_ORIGINAL_DOCUMENT_AUTH_GATE",
		});
		publication(path.join(directory, "result.json"), result);
		manifest(
			directory,
			["dev", "preview"].flatMap((name) =>
				["stdout", "stderr"].map((stream) =>
					path.join(directory, name, `${stream}.raw`),
				),
			),
		);
		preserved();
		within();
		const done = Promise.race(handles.map((h) => h.completion)).then(
			async () => {
				delete result.next;
				Object.assign(result, {
					status: "SERVING_ENDED",
					cleanup: await retire(),
				});
				result.compute = result.cleanup.compute.status;
				publish(path.join(directory, "serving-ended.json"), result);
				return result.cleanup;
			},
		);
		Object.defineProperty(result, "serving", { value: { done, stop: retire } });
		return result;
	} catch (error) {
		delete result.next;
		delete result.acceptedAt;
		Object.assign(result, {
			status: "FAIL",
			error: error.message,
			failedAt: clock(),
			cleanup: await retire(),
		});
		result.compute = result.cleanup.compute.status;
		publish(
			acquired
				? path.join(directory, "result.json")
				: path.join(config.evidence, "startup-failure.json"),
			result,
		);
		if (acquired) manifest(directory);
		throw error;
	}
}

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { quote } from "./boat.mjs";
import { markedObservation } from "./boat-547-preparation.mjs";
import {
	sourceObservation,
	sourceObservationInputs,
} from "./boat-547-source.mjs";

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
		sequenceVersion: "547-startup-v8-prebuilt-start-watch",
		owner: binding,
		started,
		deadline,
		compute: "OPEN",
	};
	const handles = [];
	const ended = Promise.withResolvers();
	const expectedEnds = new Set(),
		settlements = new Map();
	let armed = false,
		transitioning = false,
		replacement,
		consumed = false;
	let activeDeadline = deadline;
	let dev, preview;
	let acquired = false;
	let cleanupPromise;
	let sourceBusy = false,
		sourceCapture;
	const retire = () => {
		if (replacement?.status === "RUNNING")
			failReplacement(
				new Error(
					"Preview replacement phase failed; see captured phase result",
				),
			);
		cleanupPromise ??= (async () => {
			const captures = await Promise.allSettled(
				handles.map((h) => Promise.resolve().then(() => h.stop())),
			);
			const transports = captures.map((r) =>
				r.status === "fulfilled" ? r.value : { failure: r.reason.message },
			);
			// A finite source command keeps its original bound and drains before the
			// same owner stops compute. The source action never owns serving cleanup.
			await sourceCapture?.catch(() => {});
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
				status: !drained
					? "UNRESOLVED_LOCAL_TRANSPORT"
					: captures.some((r) => r.status === "rejected")
						? "CAPTURE_FINALIZATION_FAILED"
						: stopped.status,
				compute: stopped,
				transports,
			};
			try {
				publish(
					acquired
						? path.join(directory, "cleanup.json")
						: path.join(config.evidence, "startup-cleanup.json"),
					value,
				);
			} catch (error) {
				value.publicationError = error.message;
			}
			return value;
		})();
		return cleanupPromise;
	};
	const record = () => {
		try {
			publish(
				acquired
					? path.join(directory, "result.json")
					: path.join(config.evidence, "startup-failure.json"),
				result,
			);
		} catch (error) {
			result.publicationError = error.message;
		}
	};
	const revoke = (error, status = "FAIL") => {
		delete result.next;
		delete result.acceptedAt;
		Object.assign(result, {
			status,
			error: error.message,
			failedAt: clock(),
			cleanup: { status: "PENDING_OWNING_STOP" },
		});
		record();
	};
	const recordReplacement = () => {
		try {
			publish(path.join(directory, "preview-replacement.json"), replacement);
		} catch (error) {
			replacement.publicationError = error.message;
		}
	};
	const failReplacement = (error) => {
		Object.assign(replacement, {
			status: "FAIL",
			error: error.message,
			failedAt: clock(),
		});
		delete replacement.acceptedAt;
		recordReplacement();
		revoke(error);
	};
	const within = () => {
		require(clock() <
			activeDeadline, "Original startup deadline exceeded before acceptance");
		for (const handle of handles) {
			const settled = settlements.get(handle);
			if (settled?.error) throw settled.error;
			if (!expectedEnds.has(handle)) handle.assertRunning();
		}
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
	let fixed;
	const fixedPaths = [source, observer, ...sourceObservationInputs];
	const preserved = () => {
		inputs();
		require(JSON.stringify(fixed) ===
			JSON.stringify(
				fixedPaths.map(fileIdentity),
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
			{
				id,
				argv,
				inputs,
				assess,
				prepare,
				// Owned image provisioning shares the original startup enclosure.
				allowanceSeconds: id === "apps-build" ? deadline - started : undefined,
			},
			activeDeadline,
			retire,
		);
		within();
		return phase.outcome;
	};
	const wait = async (predicate, usable) => {
		const until = Math.min(activeDeadline, clock() + usable);
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
		// Observe rejection immediately, including exits before startup acceptance.
		// A rejected final receipt is an ended capture, not permission to skip cleanup.
		const observe = (completion) => {
			settlements.set(handle, completion);
			if (
				armed &&
				!transitioning &&
				(!expectedEnds.has(handle) || completion.error)
			)
				ended.resolve(completion);
		};
		handle.completion.then(
			(value) => observe({ name, value }),
			(error) => observe({ name, error }),
		);
		within();
		return handle;
	};
	const collectRoutes = async (label = "") => {
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
			path.join(directory, `${label}routes.json`),
			observations.map((r) =>
				r.status === "fulfilled" ? r.value : { error: r.reason.message },
			),
		);
		const accepted = observations.map((r) => {
			if (r.status === "rejected") throw r.reason;
			require(r.value.status ===
				200, `Readiness route failed: ${r.value.path}`);
			return r.value;
		});
		within();
		return accepted;
	};
	const collectInventory = async (label = "") => {
		let selected;
		await run(
			`${label}app-inventory`,
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
		return await run(
			`${label}app-identities`,
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
	};
	const collectOwnership = async (current, dev, label = "") => {
		const observation = path.join(
			directory,
			`${label}preview-observation-input.json`,
		);
		publish(observation, {
			oldPreview: current,
			devLauncher: launcher(dev.pid, root),
			root,
			ports: [binding.ingress, binding.ingress + 20000],
		});
		return await run(
			`${label}preview-ownership`,
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
	};
	const waitPreview = async (previous) => {
		const value = await wait(() => {
			const file = path.join(root, ".boat/preview-process.json");
			if (!fs.existsSync(file)) return false;
			const current = read(file);
			return (
				current.ready === true &&
				current.phase === "ready" &&
				current.generation !== previous &&
				current
			);
		}, 175);
		require(typeof value.generation === "string" &&
			value.generation &&
			value.forward?.startTicks &&
			value.cwd === root, "Published preview identity is incomplete");
		return value;
	};
	const liveRaw = () =>
		handles
			.filter((h) => !expectedEnds.has(h))
			.flatMap((h) =>
				["stdout", "stderr"].map((name) =>
					path.join(h.checkpointDirectory, `${name}.raw`),
				),
			);
	const stableContainers = (rows) =>
		rows.map((r) => ({
			service: r.service,
			id: r.id,
			image: r.image,
			created: r.created,
			restartCount: r.restartCount,
			labels: r.labels,
			ports: r.ports,
			pid: r.state.Pid,
			started: r.state.StartedAt,
			status: r.state.Status,
			running: r.state.Running,
			health: r.state.Health?.Status ?? null,
		}));
	const immutableProcess = (r) => ({
		pid: r.pid,
		startTicks: r.startTicks,
		group: r.group,
		session: r.session,
		cwd: r.cwd,
	});
	const replacePreview = async (request) => {
		require(!sourceBusy, "Source observation is in progress");
		require(!consumed, "Preview replacement already consumed");
		require(request &&
			typeof request === "object" &&
			Object.keys(request).sort().join(",") ===
				"action,admission,generation,worker" &&
			request.action === "replace-preview" &&
			request.worker === binding.worker &&
			request.admission === binding.admission &&
			request.generation ===
				result.preview
					.generation, "Stale or invalid preview replacement request; no action executed");
		require(!cleanupPromise, "Serving cleanup already started");
		consumed = true;
		const began = clock();
		activeDeadline = began + 600;
		transitioning = true;
		replacement = {
			phase: "preview-replacement",
			request: structuredClone(request),
			owner: binding,
			round: config.round,
			started: began,
			deadline: activeDeadline,
			status: "RUNNING",
		};
		result.startupTiming = {
			started: result.started,
			deadline: result.deadline,
			acceptedAt: result.acceptedAt,
		};
		result.phase = "preview-replacement";
		result.started = began;
		result.deadline = activeDeadline;
		delete result.acceptedAt;
		result.status = "PREVIEW_REPLACEMENT_PENDING";
		delete result.next;
		record();
		recordReplacement();
		const oldHandle = preview;
		try {
			within();
			preserved();
			const old = read(path.join(root, ".boat/preview-process.json"));
			require(old.ready &&
				old.phase === "ready" &&
				old.generation === request.generation &&
				old.pid === result.preview.pid &&
				old.startTicks === result.preview.startTicks &&
				JSON.stringify(old.forward) ===
					JSON.stringify(
						result.preview.forward,
					), "Current preview changed before replacement");
			replacement.before = {
				preview: old,
				containers: await collectInventory("replacement-before-"),
				ownership: await collectOwnership(old, dev, "replacement-before-"),
			};
			require(isDeepStrictEqual(
				stableContainers(result.containers),
				stableContainers(replacement.before.containers),
			), "Application identities changed before local preview replacement");
			within();
			preserved();
			// Only ordinary Make/controller receives predecessor-retirement authority.
			expectedEnds.add(oldHandle);
			const next = await launch("replacement-preview", [
				"make",
				"boat-preview",
			]);
			const current = await waitPreview(old.generation);
			await wait(() => settlements.get(oldHandle), 5);
			within();
			replacement.oldCapture = read(
				path.join(oldHandle.checkpointDirectory, "receipt.json"),
			);
			replacement.oldDisposal = read(
				path.join(oldHandle.checkpointDirectory, "disposal.json"),
			);
			require(replacement.oldCapture.captureComplete &&
				replacement.oldDisposal.pipesClosed &&
				replacement.oldDisposal.unresolved?.length === 0 &&
				!replacement.oldDisposal
					.failure, "Old preview terminal or drainage is unresolved");
			const eventBytes = fs.readFileSync(path.join(root, ".boat/events.jsonl"));
			publish(path.join(directory, "replacement-events.json"), {
				nativeUtf8: eventBytes.toString("utf8"),
			});
			const text = eventBytes.toString("utf8"),
				lines = text
					.slice(0, text.lastIndexOf("\n") + 1)
					.split("\n")
					.filter(Boolean)
					.map(JSON.parse);
			const events = lines.filter((e) => e.kind === "preview-lifetime");
			replacement.retired = events.findLast(
				(e) => e.generation === old.generation && e.stage === "retired",
			);
			replacement.predecessorRetired = events.findLast(
				(e) =>
					e.generation === current.generation &&
					e.stage === "predecessor-retired",
			);
			replacement.ready = events.findLast(
				(e) => e.generation === current.generation && e.stage === "ready",
			);
			require(replacement.retired?.closed === true &&
				replacement.retired.terminal &&
				replacement.predecessorRetired?.predecessor?.generation ===
					old.generation &&
				replacement.ready &&
				!events.some(
					(e) =>
						[old.generation, current.generation].includes(e.generation) &&
						["failed", "unresolved"].includes(e.stage),
				), "Native preview retirement/readiness proof differs");
			require(JSON.stringify(immutableProcess(replacement.retired.forward)) ===
				JSON.stringify(immutableProcess(old.forward)) &&
				JSON.stringify(
					immutableProcess(replacement.predecessorRetired.forward),
				) === JSON.stringify(immutableProcess(old.forward)) &&
				JSON.stringify(immutableProcess(replacement.ready.forward)) ===
					JSON.stringify(
						immutableProcess(current.forward),
					), "Native preview forward identities differ");
			require(current.generation !== old.generation &&
				current.pid !== old.pid &&
				current.forward.pid !==
					old.forward
						.pid, "Replacement did not acquire distinct actual identities");
			replacement.routes = await collectRoutes("replacement-");
			replacement.containers = await collectInventory("replacement-after-");
			require(isDeepStrictEqual(
				stableContainers(replacement.before.containers),
				stableContainers(replacement.containers),
			), "Application identities changed during local preview replacement");
			replacement.ownership = await collectOwnership(
				current,
				dev,
				"replacement-after-",
			);
			require(JSON.stringify(
				immutableProcess(replacement.before.ownership.dev),
			) ===
				JSON.stringify(
					immutableProcess(replacement.ownership.dev),
				), "Development launcher changed during preview replacement");
			preserved();
			within();
			const latest = read(path.join(root, ".boat/preview-process.json"));
			require(latest.ready &&
				latest.generation === current.generation &&
				latest.pid === current.pid &&
				latest.startTicks === current.startTicks &&
				JSON.stringify(latest.forward) ===
					JSON.stringify(
						current.forward,
					), "New preview changed before acceptance");
			Object.assign(replacement, {
				status: "PASS_PREVIEW_REPLACEMENT",
				preview: current,
				previewCapture: next.checkpoint(),
				dev: immutableProcess(replacement.ownership.dev),
				url: result.url,
				acceptedAt: clock(),
				next: "ROOT_ORIGINAL_DOCUMENT_CHECK_FIRST",
			});
			publication(
				path.join(directory, "preview-replacement.json"),
				replacement,
			);
			manifest(directory, liveRaw());
			preserved();
			within();
			preview = next;
			result.preview = current;
			result.previewCapture = replacement.previewCapture;
			result.status = "PASS_PREVIEW_REPLACEMENT";
			result.acceptedAt = replacement.acceptedAt;
			result.next = replacement.next;
			record();
			transitioning = false;
			return replacement;
		} catch (error) {
			error.actionStarted = true;
			failReplacement(error);
			replacement.cleanup = await retire();
			recordReplacement();
			transitioning = false;
			ended.resolve({ name: "preview replacement", error });
			throw error;
		}
	};
	const observeSource = async (request) => {
		require(!sourceBusy &&
			!transitioning &&
			!cleanupPromise, "Managed action or cleanup already in progress");
		const spec = sourceObservation(request, {
			root,
			binding,
			workload,
			generation: result.preview.generation,
			web: result.containers.find((row) => row.service === "web"),
		});
		require(!fs.existsSync(
			path.join(directory, spec.id),
		), "Source observation ID already consumed");
		sourceBusy = true;
		const sourceDeadline = clock() + 180;
		const sourceInputs = spec.inputs;
		spec.inputs = () => {
			require(!cleanupPromise, "Serving cleanup began during source observation");
			preservedImplementation();
			require(isDeepStrictEqual(
				fixed,
				fixedPaths.map(fileIdentity),
			), "Startup implementation changed");
			const current = read(path.join(root, ".boat/preview-process.json"));
			require(current.ready &&
				current.generation === request.generation &&
				current.pid === result.preview.pid &&
				current.startTicks === result.preview.startTicks &&
				isDeepStrictEqual(
					current.forward,
					result.preview.forward,
				), "Current preview ownership changed");
			return sourceInputs();
		};
		try {
			return await runPhase(
				spec,
				sourceDeadline,
				() => {
					revoke(
						new Error("Source observation failed; see captured phase result"),
					);
					return retire();
				},
				(argv, options) => {
					const command = make(argv, options);
					sourceCapture = command;
					return command.finally(() => {
						if (sourceCapture === command) sourceCapture = undefined;
					});
				},
			);
		} catch (error) {
			error.actionStarted = true;
			revoke(error);
			await retire();
			ended.resolve({ name: "source observation", error });
			throw error;
		} finally {
			sourceBusy = false;
		}
	};
	try {
		fs.mkdirSync(directory, { mode: 0o700 });
		acquired = true;
		fixed = fixedPaths.map(fileIdentity);
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
		await run("apps-build", ["make", "boat-prepare-app-images"]);
		await run("apps-start", ["make", "apps-start", "ARGS=--no-build"]);
		dev = await launch("dev", ["make", "dev", "ARGS=--no-up"]);
		await wait(
			() =>
				fs
					.readFileSync(path.join(directory, "dev/stdout.raw"), "utf8")
					.includes("Watch enabled"),
			60,
		);
		preview = await launch("preview", ["make", "boat-preview"]);
		const current = await waitPreview();
		result.routes = await collectRoutes();
		result.containers = await collectInventory();
		result.ownership = await collectOwnership(current, dev);
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
		armed = true;
		const done = ended.promise.then(async (completion) => {
			revoke(
				completion.error ??
					new Error(`${completion.name} serving capture ended`),
				"SERVING_ENDED",
			);
			result.cleanup = await retire();
			result.compute = result.cleanup.compute.status;
			record();
			try {
				publish(path.join(directory, "serving-ended.json"), result);
				manifest(directory);
			} catch (error) {
				result.cleanup.publicationError = error.message;
			}
			return result.cleanup;
		});
		Object.defineProperty(result, "serving", {
			value: { done, stop: retire, replacePreview, observeSource },
		});
		return result;
	} catch (error) {
		revoke(error);
		result.cleanup = await retire();
		result.compute = result.cleanup.compute.status;
		record();
		if (acquired) manifest(directory);
		throw error;
	}
}

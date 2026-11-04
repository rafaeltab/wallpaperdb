import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { markedObservation } from "./boat-547-preparation.mjs";

export const sourceObservationInputs = [
	import.meta.url,
	"../boat-workloads/547-runtime.cjs",
	"../boat-workloads/547-web-source.cjs",
].map((file) => fileURLToPath(new URL(file, import.meta.url)));

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const require = (condition, reason) => {
	if (!condition) throw new Error(reason);
};
const sources = {
	heading: {
		path: "apps/web/src/routes/upload.tsx",
		hashes: {
			A: "d3f4063d7b34435ba0e1a913c3975cfffe5c9ae7d2bc69b9416868966b876170",
			B: "d66f5a18bc16b5ca7282fb67a4dee9ccb547545f6195f5bfcc7a37808cd03ab5",
		},
	},
	presence: {
		path: "apps/web/src/boat-547-presence.txt",
		hashes: {
			present:
				"afb7b0e339d3a9151d191aa48982db28838c8b85e50b7787535f21623c6744ab",
			absent: null,
		},
	},
};

// Fixed #547 observations only. Writes and browser timing remain separately
// authorized operations; neither historical argv nor caller shell text is input.
export function sourceObservation(request, context) {
	const { root, binding, generation, web, workload } = context;
	require(request &&
		Object.keys(request).sort().join(",") ===
			"action,admission,expected,generation,id,source,worker" &&
		request.action === "observe-source" &&
		request.worker === binding.worker &&
		request.admission === binding.admission &&
		request.generation === generation &&
		typeof request.id === "string" &&
		/^[A-Za-z0-9_-]{1,80}$/.test(request.id) &&
		Object.hasOwn(sources, request.source) &&
		Object.hasOwn(
			sources[request.source].hashes,
			request.expected,
		), "Stale or invalid source observation request; no action executed");
	const selected = sources[request.source],
		hash = selected.hashes[request.expected],
		file = path.join(root, selected.path);
	const local = () => {
		const inputs = workload.browserSourceInputs(request.source);
		const stat = fs.lstatSync(file, { throwIfNoEntry: false });
		if (hash === null) {
			require(stat === undefined, "Local source must be absent");
			return { inputs, record: { path: file, lstat: "ENOENT" } };
		}
		require(stat?.isFile() &&
			!stat.isSymbolicLink(), "Local source must be regular");
		const bytes = fs.readFileSync(file);
		require(sha(bytes) ===
			hash, "Local source bytes differ from frozen expectation");
		return {
			inputs,
			record: { path: file, bytes: bytes.length, sha256: hash },
		};
	};
	return {
		id: `source-${request.id}`,
		argv: [
			"make",
			"docker-run",
			`ARGS=node scripts/boat-workloads/547-runtime.cjs source-observe ${binding.project} ${request.source}`,
		],
		inputs: () => [...local().inputs, ...sourceObservationInputs],
		assess(raw) {
			const runtime = markedObservation(raw, "BOAT547_WEB_SOURCE"),
				current = local().record;
			require(runtime.source === request.source &&
				runtime.path === `/app/${selected.path}` &&
				runtime.cwd === "/app/apps/web" &&
				typeof runtime.hostname === "string" &&
				runtime.hostname.length >= 12 &&
				web.id.startsWith(runtime.hostname) &&
				Number.isFinite(
					Date.parse(runtime.at),
				), "Current Web source identity differs");
			if (hash === null)
				require(runtime.lstat === "ENOENT", "Runtime source must be absent");
			else {
				require(Array.isArray(runtime.byteValues) &&
					runtime.byteValues.every(
						(value) => Number.isInteger(value) && value >= 0 && value <= 255,
					), "Runtime source byte values are invalid");
				const bytes = Buffer.from(runtime.byteValues ?? []);
				require(runtime.regular === true &&
					runtime.symlink === false &&
					runtime.bytes === current.bytes &&
					bytes.length === current.bytes &&
					runtime.sha256 === hash &&
					sha(bytes) ===
						hash, "Runtime source bytes differ from frozen local source");
			}
			return {
				local: current,
				runtime,
				browserVerdict:
					"Separate ROOT original-document/timing gate; runtime time is not propagation origin",
			};
		},
	};
}

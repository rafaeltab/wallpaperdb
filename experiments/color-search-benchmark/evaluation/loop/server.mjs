import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const defaultRoot = path.join(
	homedir(),
	".local/share/wallpaperdb/color-evaluation/runs",
);
const validId = (value) =>
	typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
const artifactTypes = new Map([
	["report.html", "text/html; charset=utf-8"],
	["report.md", "text/markdown; charset=utf-8"],
	["run.json", "application/json; charset=utf-8"],
	["dataset.json", "application/json; charset=utf-8"],
	["corpus.json", "application/json; charset=utf-8"],
]);
const imageTypes = new Map([
	[".jpg", "image/jpeg"],
	[".jpeg", "image/jpeg"],
	[".png", "image/png"],
	[".webp", "image/webp"],
	[".avif", "image/avif"],
	[".gif", "image/gif"],
	[".svg", "image/svg+xml"],
]);
const escapeHtml = (value) =>
	String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");

function isInside(root, filename) {
	const relative = path.relative(root, filename);
	return (
		relative !== "" &&
		relative !== ".." &&
		!relative.startsWith(`..${path.sep}`) &&
		!path.isAbsolute(relative)
	);
}

async function savedFile(root, ...parts) {
	const canonicalRoot = await realpath(root);
	const filename = await realpath(path.join(canonicalRoot, ...parts));
	if (!isInside(canonicalRoot, filename) || !(await stat(filename)).isFile())
		throw Error("Unavailable saved file");
	return filename;
}

function send(
	request,
	response,
	status,
	content,
	contentType = "text/plain; charset=utf-8",
	extraHeaders = {},
) {
	const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
	response.writeHead(status, {
		"Content-Type": contentType,
		"Content-Length": bytes.length,
		"Cache-Control": "no-store",
		"X-Content-Type-Options": "nosniff",
		"Content-Security-Policy":
			"default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
		...extraHeaders,
	});
	response.end(request.method === "HEAD" ? undefined : bytes);
}

async function indexHtml(root) {
	let entries;
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch (error) {
		if (error.code === "ENOENT") entries = [];
		else throw error;
	}
	const runs = [];
	for (const entry of entries) {
		if (!entry.isDirectory() || !validId(entry.name)) continue;
		try {
			await savedFile(root, entry.name, "report.html");
			runs.push(entry.name);
		} catch {
			/* Ignore partial runs and entries without a contained report. */
		}
	}
	runs.sort().reverse();
	const list = runs.length
		? `<ul>${runs.map((id) => `<li><a href="/${encodeURIComponent(id)}/report.html">${escapeHtml(id)}</a></li>`).join("")}</ul>`
		: "<p>No saved runs yet.</p>";
	return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Color evaluation runs</title><style>body{font:17px/1.5 system-ui,sans-serif;max-width:900px;margin:3rem auto;padding:0 1.5rem;background:#171b22;color:#e8edf5}a{color:#a8cdff}li{margin:.7rem 0}p{color:#bfc8d8}</style><h1>Color evaluation runs</h1><p>Saved accuracy and performance reports. This viewer only reads completed reports.</p>${runs.length ? '<p><a href="/latest">Open latest report</a></p>' : ""}${list}</html>`;
}

async function imageForRun(root, runId, imageId) {
	const manifest = JSON.parse(
		await readFile(await savedFile(root, runId, "corpus.json"), "utf8"),
	);
	if (!Array.isArray(manifest)) throw Error("Invalid corpus manifest");
	const matches = manifest.filter((item) => item.id === imageId);
	if (matches.length !== 1) throw Error("Unknown or ambiguous image");
	const image = matches[0];
	if (
		typeof image.filename !== "string" ||
		!path.isAbsolute(image.filename) ||
		!/^[a-f0-9]{64}$/.test(image.sha256)
	) {
		throw Error("Invalid pinned source");
	}
	// Image paths may be in the shared library, outside the report directory.
	// The immutable corpus manifest is the allowlist; URLs supply only an ID.
	const filename = await realpath(image.filename);
	const contentType = imageTypes.get(path.extname(filename).toLowerCase());
	if (
		!contentType ||
		!imageTypes.has(path.extname(image.filename).toLowerCase()) ||
		!(await stat(filename)).isFile()
	) {
		throw Error("Unsupported image source");
	}
	const bytes = await readFile(filename);
	if (createHash("sha256").update(bytes).digest("hex") !== image.sha256)
		throw Error("Source image changed");
	return { bytes, contentType };
}

/** Return an unbound server; importing this module never starts a listener. */
export function createReportServer({ root = defaultRoot } = {}) {
	root = path.resolve(root);
	return createServer(async (request, response) => {
		if (!["GET", "HEAD"].includes(request.method)) {
			send(request, response, 405, "Read-only report viewer\n", undefined, {
				Allow: "GET, HEAD",
			});
			return;
		}
		try {
			// Parse the raw path ourselves so URL normalization cannot erase a ..
			// segment before the route's identifier and artifact allowlists see it.
			const rawPath = request.url.split("?")[0];
			let segments;
			try {
				segments = rawPath.split("/").slice(1).map(decodeURIComponent);
			} catch {
				send(request, response, 400, "Invalid URL\n");
				return;
			}
			if (segments.at(-1) === "") segments.pop();
			if (segments.length === 0) {
				send(
					request,
					response,
					200,
					await indexHtml(root),
					"text/html; charset=utf-8",
				);
				return;
			}
			if (segments.length === 1 && segments[0] === "latest") {
				const latest = JSON.parse(
					await readFile(await savedFile(root, "latest.json"), "utf8"),
				);
				if (!validId(latest.id)) throw Error("Invalid latest run ID");
				await savedFile(root, latest.id, "report.html");
				send(request, response, 302, "", undefined, {
					Location: `/${encodeURIComponent(latest.id)}/report.html`,
				});
				return;
			}
			const [runId, name, imageId] = segments;
			if (!validId(runId)) throw Error("Invalid run ID");
			if (segments.length === 1) {
				await savedFile(root, runId, "report.html");
				send(request, response, 302, "", undefined, {
					Location: `/${encodeURIComponent(runId)}/report.html`,
				});
				return;
			}
			if (segments.length === 2 && artifactTypes.has(name)) {
				const bytes = await readFile(await savedFile(root, runId, name));
				send(request, response, 200, bytes, artifactTypes.get(name));
				return;
			}
			if (segments.length === 3 && name === "images" && validId(imageId)) {
				const image = await imageForRun(root, runId, imageId);
				send(request, response, 200, image.bytes, image.contentType, {
					"Content-Security-Policy": "default-src 'none'; sandbox",
				});
				return;
			}
			send(request, response, 404, "Saved report or image not found\n");
		} catch {
			send(request, response, 404, "Saved report or image not found\n");
		}
	});
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
	const host = process.env.COLOR_EVAL_HOST ?? "0.0.0.0";
	const port = Number(process.env.COLOR_EVAL_PORT ?? 8224);
	if (!Number.isInteger(port) || port < 1 || port > 65535)
		throw Error("COLOR_EVAL_PORT must be between 1 and 65535");
	const server = createReportServer({
		root: process.env.COLOR_EVAL_RUNS_DIR ?? defaultRoot,
	});
	server.listen(port, host);
	await once(server, "listening");
	console.log(`Color evaluation reports listening on http://${host}:${port}/`);
}

// Static prototype server; no mutation API or external requests.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname, sep } from "node:path";
const root = fileURLToPath(new URL("./", import.meta.url));
const port = 8220;
const host = process.env.COLOR_PROPORTIONS_HOST || "127.0.0.1";
const authority = host.includes(":") ? `[${host}]` : host;
const url = `http://${authority}:${port}/proportions.html`;
try {
	// A loopback response cannot establish that a wildcard listener is running.
	if (host === "0.0.0.0" || host === "::") throw Error("Bind wildcard directly");
	const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
	if (response.ok && (await response.text()).includes("proportions-ui.mjs")) {
		console.log(`Proportion prototype already served: ${url}`);
		process.exit(0);
	}
} catch {
	/* Start the static server when no existing report server is available. */
}
const types = {
	".html": "text/html; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".svg": "image/svg+xml",
	".webp": "image/webp",
	".md": "text/plain; charset=utf-8",
};
createServer(async (request, response) => {
	try {
		const pathname = decodeURIComponent(
			new URL(request.url, "http://localhost").pathname,
		);
		const path = resolve(
			root,
			pathname === "/" ? "proportions.html" : `.${pathname}`,
		);
		if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) {
			response.writeHead(403);
			response.end("Forbidden");
			return;
		}
		if (request.method !== "GET" && request.method !== "HEAD") {
			response.writeHead(405);
			response.end();
			return;
		}
		const info = await stat(path);
		if (!info.isFile()) throw Error("not a file");
		response.writeHead(200, {
			"content-type": types[extname(path)] ?? "application/octet-stream",
			"cache-control": "no-cache",
		});
		response.end(request.method === "HEAD" ? undefined : await readFile(path));
	} catch {
		response.writeHead(404);
		response.end("Not found");
	}
})
	.listen(port, host, () =>
		console.log(`Proportion prototype: ${url}\nPress Ctrl+C to stop.`),
	)
	.on("error", (error) => {
		console.error(error.message);
		process.exitCode = 1;
	});

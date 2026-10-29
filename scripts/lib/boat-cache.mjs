import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID, timingSafeEqual } from "node:crypto";

// Vercel is a read-only baseline source. All experiment writes are cohort-local.
export function cacheServer({
	directory,
	cohort,
	token,
	upstream,
	record = () => {},
}) {
	const cohortDir = path.join(directory, cohort);
	fs.mkdirSync(cohortDir, { recursive: true, mode: 0o700 });
	return http.createServer(async (req, res) => {
		const auth = Buffer.from(req.headers.authorization ?? "");
		const expected = Buffer.from(`Bearer ${token}`);
		if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) {
			res.writeHead(401);
			res.end();
			return;
		}
		const url = new URL(req.url, "http://localhost");
		if (url.pathname === "/v8/artifacts/status") {
			res.setHeader("content-type", "application/json");
			res.end('{"status":"enabled"}');
			return;
		}
		if (url.pathname === "/v8/artifacts/events") {
			res.end("{}");
			req.resume();
			return;
		}
		const match = url.pathname.match(/^\/v8\/artifacts\/([a-f0-9]{16,64})$/);
		if (!match) {
			res.writeHead(404);
			res.end();
			return;
		}
		const key = match[1],
			dest = path.join(cohortDir, key);
		try {
			if (req.method === "PUT") {
				const temporary = `${dest}.${randomUUID()}`;
				const file = fs.createWriteStream(temporary, { mode: 0o600 });
				let bytes = 0;
				req.on("data", (b) => {
					bytes += b.length;
					if (bytes > 256 * 1024 * 1024)
						req.destroy(new Error("Artifact too large"));
				});
				req.pipe(file);
				req.on("error", () => {
					file.destroy();
					fs.rmSync(temporary, { force: true });
				});
				file.on("error", () => {
					res.writeHead(500);
					res.end();
				});
				file.on("finish", () => {
					fs.renameSync(temporary, dest);
					record({ method: "PUT", key, bytes, cohort });
					res.end("{}");
				});
				return;
			}
			if (!["GET", "HEAD"].includes(req.method)) {
				res.writeHead(405);
				res.end();
				return;
			}
			let source = [dest, path.join(directory, "seed", key)].find((p) =>
				fs.existsSync(p),
			);
			if (
				!source &&
				upstream &&
				!fs.existsSync(path.join(directory, "frozen.json"))
			) {
				const response = await fetch(
					`https://api.vercel.com/v8/artifacts/${key}?slug=${encodeURIComponent(upstream.team)}`,
					{
						headers: { Authorization: `Bearer ${upstream.token}` },
						signal: AbortSignal.timeout(30000),
					},
				);
				if (response.ok) {
					const bytes = Buffer.from(await response.arrayBuffer());
					const seed = path.join(directory, "seed");
					fs.mkdirSync(seed, { recursive: true, mode: 0o700 });
					source = path.join(seed, key);
					fs.writeFileSync(source, bytes, { mode: 0o600 });
				} else if (response.status !== 404)
					record({ upstreamStatus: response.status, key });
			}
			if (!source) {
				record({ method: req.method, key, hit: false, cohort });
				res.writeHead(404);
				res.end();
				return;
			}
			const stat = fs.statSync(source);
			res.setHeader("content-type", "application/octet-stream");
			res.setHeader("content-length", stat.size);
			record({ method: req.method, key, hit: true, bytes: stat.size, cohort });
			if (req.method === "HEAD") res.end();
			else fs.createReadStream(source).pipe(res);
		} catch (error) {
			record({ error: error.message });
			if (!res.headersSent) res.writeHead(502);
			res.end();
		}
	});
}

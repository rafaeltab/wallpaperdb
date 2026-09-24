import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createReportServer } from "./server.mjs";

async function fixture(t) {
	const root = await mkdtemp(path.join(tmpdir(), "color-eval-server-"));
	const server = createReportServer({ root });
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const origin = `http://127.0.0.1:${server.address().port}`;
	t.after(async () => {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
		await rm(root, { recursive: true, force: true });
	});
	return { root, origin };
}

async function saveRun(root, id = "2026-09-19-run") {
	const directory = path.join(root, id);
	await mkdir(directory);
	await writeFile(path.join(directory, "report.html"), "<h1>Saved report</h1>");
	await writeFile(path.join(directory, "report.md"), "# Saved report\n");
	await writeFile(path.join(directory, "run.json"), JSON.stringify({ id }));
	await writeFile(
		path.join(directory, "dataset.json"),
		JSON.stringify({ cases: [] }),
	);
	await writeFile(path.join(directory, "corpus.json"), "[]");
	return directory;
}

function rawGet(origin, urlPath) {
	return new Promise((resolve, reject) => {
		const req = request(origin, { path: urlPath }, (response) => {
			const chunks = [];
			response.on("data", (chunk) => chunks.push(chunk));
			response.on("end", () =>
				resolve({
					status: response.statusCode,
					text: Buffer.concat(chunks).toString(),
				}),
			);
		});
		req.on("error", reject);
		req.end();
	});
}

test("lists saved reports, resolves latest, and serves only supported report artifacts", async (t) => {
	const { root, origin } = await fixture(t);
	assert.match(await (await fetch(origin)).text(), /No saved runs/i);
	assert.equal((await fetch(`${origin}/latest`)).status, 404);
	const directory = await saveRun(root);
	await writeFile(
		path.join(root, "latest.json"),
		JSON.stringify({ id: "2026-09-19-run" }),
	);
	await writeFile(path.join(directory, "private.txt"), "private");
	const list = await (await fetch(origin)).text();
	assert.match(list, /2026-09-19-run\/report\.html/);
	const latest = await fetch(`${origin}/latest`, { redirect: "manual" });
	assert.equal(latest.status, 302);
	assert.equal(latest.headers.get("location"), "/2026-09-19-run/report.html");
	const html = await fetch(`${origin}/2026-09-19-run/report.html`);
	assert.equal(html.status, 200);
	assert.match(html.headers.get("content-type"), /text\/html/);
	assert.match(await html.text(), /Saved report/);
	assert.equal((await fetch(`${origin}/2026-09-19-run/run.json`)).status, 200);
	assert.equal(
		(await fetch(`${origin}/2026-09-19-run/private.txt`)).status,
		404,
	);
	assert.equal((await fetch(`${origin}/unknown/report.html`)).status, 404);
	const head = await fetch(`${origin}/2026-09-19-run/report.html`, {
		method: "HEAD",
	});
	assert.equal(head.status, 200);
	assert.equal(await head.text(), "");
});

test("rejects mutations, path traversal, and symlink escape outside the run root", async (t) => {
	const { root, origin } = await fixture(t);
	await saveRun(root);
	const outside = await mkdtemp(path.join(tmpdir(), "color-eval-private-"));
	t.after(() => rm(outside, { recursive: true, force: true }));
	await writeFile(path.join(outside, "report.html"), "outside secret");
	await symlink(outside, path.join(root, "escape"));
	await symlink(
		path.join(outside, "report.html"),
		path.join(root, "2026-09-19-run", "dataset-link.json"),
	);
	assert.equal(
		(
			await fetch(`${origin}/2026-09-19-run/report.html`, {
				method: "POST",
				body: "change",
			})
		).status,
		405,
	);
	for (const target of [
		"/../report.html",
		"/%2e%2e/report.html",
		"/2026-09-19-run/%2e%2e/run.json",
		"/2026-09-19-run%2f..%2fescape/report.html",
		"/escape/report.html",
	]) {
		const result = await rawGet(origin, target);
		assert.ok(
			[400, 404].includes(result.status),
			`${target}: ${result.status}`,
		);
		assert.ok(!result.text.includes("outside secret"));
	}
	await rm(path.join(root, "2026-09-19-run", "dataset.json"));
	await symlink(
		path.join(outside, "report.html"),
		path.join(root, "2026-09-19-run", "dataset.json"),
	);
	assert.equal(
		(await fetch(`${origin}/2026-09-19-run/dataset.json`)).status,
		404,
	);
	await writeFile(
		path.join(root, "latest.json"),
		JSON.stringify({ id: "../escape" }),
	);
	assert.equal(
		(await fetch(`${origin}/latest`, { redirect: "manual" })).status,
		404,
	);
});

test("image routes use immutable corpus IDs, allowed types, and verified hashes", async (t) => {
	const { root, origin } = await fixture(t);
	const directory = await saveRun(root);
	const images = await mkdtemp(path.join(tmpdir(), "color-eval-assets-"));
	t.after(() => rm(images, { recursive: true, force: true }));
	const imageBytes = Buffer.from(
		'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
	);
	const filename = path.join(images, "fixture.svg");
	await writeFile(filename, imageBytes);
	const hash = createHash("sha256").update(imageBytes).digest("hex");
	await writeFile(path.join(images, "secret.txt"), "not an image");
	await writeFile(
		path.join(directory, "corpus.json"),
		JSON.stringify([
			{ id: "fixture", filename, sha256: hash },
			{ id: "bad-hash", filename, sha256: "0".repeat(64) },
			{ id: "secret", filename: path.join(images, "secret.txt"), sha256: hash },
		]),
	);
	const image = await fetch(`${origin}/2026-09-19-run/images/fixture`);
	assert.equal(image.status, 200);
	assert.equal(image.headers.get("content-type"), "image/svg+xml");
	assert.equal(await image.text(), imageBytes.toString());
	assert.match(image.headers.get("content-security-policy"), /sandbox/);
	assert.equal(
		(await fetch(`${origin}/2026-09-19-run/images/unknown`)).status,
		404,
	);
	assert.equal(
		(await fetch(`${origin}/2026-09-19-run/images/bad-hash`)).status,
		404,
	);
	assert.equal(
		(await fetch(`${origin}/2026-09-19-run/images/secret`)).status,
		404,
	);
	assert.equal(
		(await rawGet(origin, "/2026-09-19-run/images/%2e%2e%2fsecret.txt")).status,
		404,
	);
});

import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const equal = (left, right) => {
	const supplied = Buffer.from(left ?? "");
	const expected = Buffer.from(right);
	return (
		supplied.length === expected.length && timingSafeEqual(supplied, expected)
	);
};
const escapeHtml = (value) =>
	String(value).replace(
		/[&<>"']/g,
		(character) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				character
			],
	);
function isNotice(value) {
	return (
		value !== null &&
		typeof value === "object" &&
		/^[a-f0-9]{64}$/.test(value.id) &&
		(!Object.hasOwn(value, "resultId") ||
			(typeof value.resultId === "string" &&
				/^[a-f0-9]{64}$/.test(value.resultId))) &&
		(!Object.hasOwn(value, "sourceConfirmationId") ||
			(typeof value.sourceConfirmationId === "string" &&
				/^source-accepted:source_[a-f0-9-]{36}$/.test(
					value.sourceConfirmationId,
				))) &&
		/^[A-Za-z0-9_-]{1,64}$/.test(value.applicationId) &&
		[
			"command-quarantine",
			"result-quarantine",
			"source-confirmation-quarantine",
			"wallpaper-workflow-quarantine",
		].includes(value.kind) &&
		typeof value.subject === "string" &&
		value.subject.length <= 256 &&
		["invalid", "exhausted"].includes(value.reason)
	);
}
function problem(response, status, type, title, detail) {
	response.writeHead(status, { "Content-Type": "application/problem+json" });
	response.end(
		JSON.stringify({
			type: `https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/${type}.md`,
			title,
			status,
			detail,
		}),
	);
}
/** A local development operator destination. It exposes receipts, never Asset or
 * broker management. Delivery succeeds only after its receipt survives restart. */
export async function createOperatorInbox({ directory, token }) {
	if (typeof token !== "string" || !token)
		throw new Error("Operator inbox credential required");
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const path = join(directory, "receipts.json");
	let records = new Map();
	try {
		records = new Map(
			JSON.parse(await readFile(path, "utf8")).map((record) => [
				`${record.notice.applicationId}:${record.notice.id}`,
				record,
			]),
		);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	let writing = Promise.resolve();
	return createServer(async (request, response) => {
		response.setHeader("Cache-Control", "no-store");
		if (request.method === "GET" && request.url === "/health") {
			response.writeHead(200).end("ready");
			return;
		}
		const authorized =
			request.url === "/events"
				? equal(request.headers.authorization, `Bearer ${token}`)
				: equal(
						request.headers.authorization,
						`Basic ${Buffer.from(`operator:${token}`).toString("base64")}`,
					);
		if (!authorized) {
			response.setHeader(
				"WWW-Authenticate",
				'Basic realm="WallpaperDB operator inbox"',
			);
			problem(
				response,
				401,
				"unauthorized",
				"Unauthorized",
				"Valid operator inbox credentials are required.",
			);
			return;
		}
		try {
			if (request.method === "POST" && request.url === "/events") {
				const chunks = [];
				let size = 0;
				for await (const chunk of request) {
					size += chunk.length;
					if (size > 8192) {
						problem(
							response,
							413,
							"payload-too-large",
							"Payload too large",
							"Operator notices must not exceed 8192 bytes.",
						);
						return;
					}
					chunks.push(chunk);
				}
				let notice;
				try {
					notice = JSON.parse(Buffer.concat(chunks).toString("utf8"));
				} catch {
					problem(
						response,
						400,
						"invalid-operator-notice",
						"Invalid operator notice",
						"A valid operator notice is required.",
					);
					return;
				}
				if (!isNotice(notice)) {
					problem(
						response,
						400,
						"invalid-operator-notice",
						"Invalid operator notice",
						"A valid operator notice is required.",
					);
					return;
				}
				const accepted = writing
					.catch(() => {})
					.then(async () => {
						const id = `${notice.applicationId}:${notice.id}`;
						if (records.has(id)) return;
						const next = new Map(
							[
								...records,
								[id, { notice, receivedAt: new Date().toISOString() }],
							].slice(-1000),
						);
						await writeFile(`${path}.tmp`, JSON.stringify([...next.values()]), {
							mode: 0o600,
						});
						await rename(`${path}.tmp`, path);
						records = next;
					});
				writing = accepted;
				await accepted;
				response.writeHead(200).end();
				return;
			}
			if (request.method === "GET" && request.url === "/receipts") {
				response.setHeader("Content-Type", "application/json");
				response.end(JSON.stringify([...records.values()]));
				return;
			}
			if (request.method === "GET" && request.url === "/") {
				response.setHeader("Content-Type", "text/html; charset=utf-8");
				response.end(
					`<!doctype html><html lang="en"><title>WallpaperDB operator inbox</title><meta name="viewport" content="width=device-width"><style>body{font:16px system-ui;max-width:70rem;margin:3rem auto;padding:1rem;background:#111827;color:#f9fafb}article{padding:1rem;border:1px solid #4b5563;margin:1rem 0}pre{white-space:pre-wrap}</style><h1>Operator inbox</h1><p>Durable local delivery receipts. Recover failed work through the trusted operator CLI.</p>${
						[...records.values()]
							.reverse()
							.map(
								(record) =>
									`<article><p>${escapeHtml(record.receivedAt)}</p><pre>${escapeHtml(JSON.stringify(record.notice, null, 2))}</pre></article>`,
							)
							.join("") || "<p>No notifications received.</p>"
					}</html>`,
				);
				return;
			}
			problem(
				response,
				404,
				"not-found",
				"Not found",
				"The requested operator inbox route is unavailable.",
			);
		} catch {
			problem(
				response,
				503,
				"service-unavailable",
				"Service unavailable",
				"The operator inbox could not complete the request. Try again later.",
			);
		}
	});
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const config = JSON.parse(
		await readFile(process.env.OPERATOR_INBOX_CONFIG, "utf8"),
	);
	const server = await createOperatorInbox({
		directory: process.env.OPERATOR_INBOX_DATA ?? "/data",
		token: config.operatorNotification.token,
	});
	server.listen(3012, "0.0.0.0");
	process.once("SIGTERM", () => {
		server.close();
		server.closeAllConnections();
	});
}

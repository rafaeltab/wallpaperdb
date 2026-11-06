import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { createOperatorInbox } from "./operator-inbox.ts";
import type { PathLike } from "node:fs";

const notice: Record<string, unknown> = {
	id: "a".repeat(64),
	applicationId: "user",
	kind: "result-quarantine",
	subject: "asset.results.user",
	reason: "exhausted",
};
const operator = {
	authorization: `Basic ${Buffer.from("operator:test-inbox-token").toString("base64")}`,
};
const application = { authorization: "Bearer test-inbox-token" };

async function assertProblem(
	response: Response,
	expected:
		| { type: string; title: string; status: number; detail: string }
		| { type: string; title: string; status: number; detail: string },
) {
	expect(response.status).toBe(expected.status);
	expect(response.headers.get("content-type")).toBe("application/problem+json");
	expect(response.headers.get("cache-control")).toBe("no-store");
	expect(await response.json()).toStrictEqual(expected);
}

for (const kind of [
	"command-quarantine",
	"result-quarantine",
	"source-confirmation-quarantine",
	"wallpaper-workflow-quarantine",
	"user-workflow-quarantine",
	"cleanup-quarantine",
])
	test(`${kind} receipts require credentials, survive restart and deduplicate delivery`, async () => {
		const receipt = {
			...notice,
			kind,
			subject:
				kind === "cleanup-quarantine"
					? "asset.cleanup.candidate:candidate_test"
					: notice.subject,
			...(kind === "cleanup-quarantine"
				? {
						context: {
							occurrence: {
								source: "https://wallpaperdb/asset/authors",
								id: "cancelled-candidate",
							},
							correlationId: "cleanup-request",
							traceparent:
								"00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
						},
					}
				: {}),
		};
		const directory = await mkdtemp(join(tmpdir(), "asset-operator-inbox-"));
		let server: import("node:http").Server;
		async function start() {
			server = await createOperatorInbox({
				directory,
				token: "test-inbox-token",
			});
			server.listen(0, "127.0.0.1");
			await once(server, "listening");
			return `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
		}
		const stop = async () => {
			server.closeAllConnections();
			await new Promise((resolve) => server.close(resolve));
		};
		try {
			let url = await start();
			const health = await fetch(`${url}/health`);
			expect(health.status).toBe(200);
			expect(await health.text()).toBe("ready");
			for (const response of [
				await fetch(`${url}/`),
				await fetch(`${url}/receipts`, { headers: application }),
				await fetch(`${url}/events`, {
					method: "POST",
					body: JSON.stringify(receipt),
				}),
				await fetch(`${url}/events`, {
					method: "POST",
					headers: operator,
					body: JSON.stringify(receipt),
				}),
			]) {
				expect(response.headers.get("www-authenticate")).toBe(
					'Basic realm="WallpaperDB operator inbox"',
				);
				await assertProblem(response, {
					type: "https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/unauthorized.md",
					title: "Unauthorized",
					status: 401,
					detail: "Valid operator inbox credentials are required.",
				});
			}
			for (let delivery = 0; delivery < 2; delivery++) {
				const response = await fetch(`${url}/events`, {
					method: "POST",
					headers: application,
					body:
						delivery === 0
							? JSON.stringify(receipt).padEnd(8192, " ")
							: JSON.stringify(receipt),
				});
				expect(response.status).toBe(200);
				expect(await response.text()).toBe("");
			}
			await stop();
			url = await start();
			const replay = await fetch(`${url}/events`, {
				method: "POST",
				headers: application,
				body: JSON.stringify(receipt),
			});
			expect(replay.status).toBe(200);
			expect(await replay.text()).toBe("");
			const response = await fetch(`${url}/receipts`, { headers: operator });
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe("application/json");
			const receipts = await response.json();
			expect(receipts.length).toBe(1);
			expect(receipts[0].notice).toStrictEqual(receipt);
			expect(
				await (await fetch(`${url}/`, { headers: operator })).text(),
			).toMatch(new RegExp(kind));
		} finally {
			await stop();
			await rm(directory, { recursive: true, force: true });
		}
	});

test("optional recovery targets are validated without rejecting legacy notices", async (t) => {
	const releases: { (): Promise<void>; (): Promise<void> }[] = [];
	t.onTestFinished(async () => {
		const failures = [];
		for (const release of releases.reverse()) {
			try {
				await release();
			} catch (caught) {
				const error = caught as NodeJS.ErrnoException & { status?: number };
				failures.push(error);
			}
		}
		if (failures.length)
			throw new AggregateError(failures, "Recovery notice HTTP cleanup failed");
	});
	const directory = await mkdtemp(join(tmpdir(), "asset-operator-inbox-"));
	releases.push(() => rm(directory, { recursive: true, force: true }));
	const server: import("node:http").Server = await createOperatorInbox({
		directory,
		token: "test-inbox-token",
	});
	releases.push(async () => {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const url = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
	const deliver = (value: unknown) =>
		fetch(`${url}/events`, {
			method: "POST",
			headers: application,
			body: JSON.stringify(value),
		});
	const valid = [
		notice,
		{ ...notice, id: "b".repeat(64), resultId: "f".repeat(64) },
		{
			...notice,
			id: "c".repeat(64),
			kind: "command-quarantine",
			subject: "asset.commands.user.create",
		},
		{
			...notice,
			id: "e".repeat(64),
			kind: "source-confirmation-quarantine",
			sourceConfirmationId:
				"source-accepted:source_01234567-89ab-cdef-0123-456789abcdef",
		},
		{ ...notice, id: "f".repeat(64), kind: "source-confirmation-quarantine" },
	];
	for (const value of valid) {
		const response = await deliver(value);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("");
	}
	for (const resultId of [
		null,
		42,
		{},
		[],
		["f".repeat(64)],
		"",
		"f".repeat(63),
		"F".repeat(64),
		"g".repeat(64),
	]) {
		await assertProblem(
			await deliver({ ...notice, id: "d".repeat(64), resultId }),
			{
				type: "https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/invalid-operator-notice.md",
				title: "Invalid operator notice",
				status: 400,
				detail: "A valid operator notice is required.",
			},
		);
	}
	for (const sourceConfirmationId of [
		null,
		42,
		{},
		[],
		["source-accepted:source_01234567-89ab-cdef-0123-456789abcdef"],
		"",
		"f".repeat(64),
		"source-accepted:source_recovery",
		"source_01234567-89ab-cdef-0123-456789abcdef",
		"source-accepted:source_01234567-89AB-cdef-0123-456789abcdef",
		"source-accepted:source_01234567-89ab-cdef-0123-456789abcdeg",
		"source-accepted:source_01234567-89ab-cdef-0123-456789abcde",
		"source-accepted:source_01234567-89ab-cdef-0123-456789abcdef0",
	]) {
		await assertProblem(
			await deliver({
				...notice,
				kind: "source-confirmation-quarantine",
				sourceConfirmationId,
			}),
			{
				type: "https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/invalid-operator-notice.md",
				title: "Invalid operator notice",
				status: 400,
				detail: "A valid operator notice is required.",
			},
		);
	}

	const receipts = await (
		await fetch(`${url}/receipts`, { headers: operator })
	).json();
	expect(
		receipts.map((receipt: { notice: any }) => receipt.notice),
	).toStrictEqual(valid);
});

describe("operator HTTP errors disclose only safe Problem Details", () => {
	let directory: PathLike;
	let url: string;
	beforeEach(async (t) => {
		directory = await mkdtemp(join(tmpdir(), "asset-operator-inbox-"));
		const server: import("node:http").Server = await createOperatorInbox({
			directory,
			token: "test-inbox-token",
		});
		t.onTestFinished(async () => {
			server.closeAllConnections();
			await new Promise((resolve) => server.close(resolve));
			await rm(directory, { recursive: true, force: true });
		});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		url = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
	});
	for (const { name, path, options, expected } of [
		{
			name: "malformed JSON",
			path: "/events",
			options: {
				method: "POST",
				headers: application,
				body: '{"private-marker":',
			},
			expected: {
				type: "https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/invalid-operator-notice.md",
				title: "Invalid operator notice",
				status: 400,
				detail: "A valid operator notice is required.",
			},
		},
		{
			name: "invalid notice",
			path: "/events",
			options: {
				method: "POST",
				headers: application,
				body: JSON.stringify({ ...notice, kind: "private-marker" }),
			},
			expected: {
				type: "https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/invalid-operator-notice.md",
				title: "Invalid operator notice",
				status: 400,
				detail: "A valid operator notice is required.",
			},
		},
		{
			name: "oversized notice",
			path: "/events",
			options: {
				method: "POST",
				headers: application,
				body: JSON.stringify(notice).padEnd(8193, " "),
			},
			expected: {
				type: "https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/payload-too-large.md",
				title: "Payload too large",
				status: 413,
				detail: "Operator notices must not exceed 8192 bytes.",
			},
		},
		{
			name: "missing route",
			path: "/private-marker",
			options: { headers: operator },
			expected: {
				type: "https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/not-found.md",
				title: "Not found",
				status: 404,
				detail: "The requested operator inbox route is unavailable.",
			},
		},
	]) {
		test(name, async () => {
			await assertProblem(await fetch(`${url}${path}`, options), expected);
		});
	}
	test("receipt storage failure and retry", async () => {
		await rm(directory, { recursive: true });
		const deliver = () =>
			fetch(`${url}/events`, {
				method: "POST",
				headers: application,
				body: JSON.stringify(notice),
			});
		await assertProblem(await deliver(), {
			type: "https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/service-unavailable.md",
			title: "Service unavailable",
			status: 503,
			detail:
				"The operator inbox could not complete the request. Try again later.",
		});
		expect(
			await (await fetch(`${url}/receipts`, { headers: operator })).json(),
		).toStrictEqual([]);
		await mkdir(directory, { mode: 0o700 });
		expect((await deliver()).status).toBe(200);
		const receipts = await (
			await fetch(`${url}/receipts`, { headers: operator })
		).json();
		expect(receipts.length).toBe(1);
		expect(receipts[0].notice).toStrictEqual(notice);
	});
});

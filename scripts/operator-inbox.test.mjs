import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createOperatorInbox } from "./operator-inbox.mjs";

for (const kind of [
	"result-quarantine",
	"source-confirmation-quarantine",
	"wallpaper-workflow-quarantine",
])
	test(`${kind} receipts require credentials, survive restart and deduplicate delivery`, async () => {
		const directory = await mkdtemp(join(tmpdir(), "asset-operator-inbox-"));
		let server;
		async function start() {
			server = await createOperatorInbox({
				directory,
				token: "test-inbox-token",
			});
			server.listen(0, "127.0.0.1");
			await once(server, "listening");
			return `http://127.0.0.1:${server.address().port}`;
		}
		const stop = async () => {
			server.closeAllConnections();
			await new Promise((resolve) => server.close(resolve));
		};
		const notice = {
			id: "a".repeat(64),
			applicationId: "user",
			kind,
			subject: "asset.results.user",
			reason: "exhausted",
		};
		const operator = {
			authorization: `Basic ${Buffer.from("operator:test-inbox-token").toString("base64")}`,
		};
		try {
			let url = await start();
			assert.equal((await fetch(`${url}/`)).status, 401);
			assert.equal(
				(
					await fetch(`${url}/events`, {
						method: "POST",
						body: JSON.stringify(notice),
					})
				).status,
				401,
			);
			for (let delivery = 0; delivery < 2; delivery++)
				assert.equal(
					(
						await fetch(`${url}/events`, {
							method: "POST",
							headers: { authorization: "Bearer test-inbox-token" },
							body: JSON.stringify(notice),
						})
					).status,
					200,
				);
			await stop();
			url = await start();
			const response = await fetch(`${url}/receipts`, { headers: operator });
			assert.equal(response.status, 200);
			const receipts = await response.json();
			assert.equal(receipts.length, 1);
			assert.deepEqual(receipts[0].notice, notice);
			assert.match(
				await (await fetch(`${url}/`, { headers: operator })).text(),
				new RegExp(kind),
			);
		} finally {
			await stop();
			await rm(directory, { recursive: true, force: true });
		}
	});

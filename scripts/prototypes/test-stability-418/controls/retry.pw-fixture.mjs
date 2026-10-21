import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
const require = createRequire(
	new URL("../../../../apps/web-e2e/package.json", import.meta.url),
);
const { test, expect } = require("@playwright/test");
test.beforeEach(async () => {
	expect(await readFile(process.env.STABILITY_SETUP, "utf8")).toBe("ready");
});
test("fails first attempt then passes retry", async () => {
	const info = test.info();
	await info.attach("attempt", {
		body: `retry=${info.retry}`,
		contentType: "text/plain",
	});
	expect(info.retry).toBeGreaterThan(0);
});
test("clean no-retry control", () => {
	expect(true).toBe(true);
});

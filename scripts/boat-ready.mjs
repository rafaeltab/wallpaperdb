import fs from "node:fs";
import { verifyWebE2EEnvironment } from "../apps/web-e2e/src/environment-contract.ts";
const port = fs
	.readFileSync(".worktree", "utf8")
	.match(/^INGRESS_PORT\s*[:?]?=\s*(\d+)/m)?.[1];
if (!port) throw new Error("Missing generated ingress port");
const started = Date.now();
let failure;
while (Date.now() - started < 600000) {
	try {
		await verifyWebE2EEnvironment({ INGRESS_PORT: port }, (url, options) =>
			fetch(url, { ...options, signal: AbortSignal.timeout(5000) }),
		);
		console.log(`Application health passed in ${Date.now() - started}ms`);
		failure = null;
		break;
	} catch (error) {
		failure = error;
		if (process.argv.includes("--once")) break;
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
}
if (failure) throw failure;

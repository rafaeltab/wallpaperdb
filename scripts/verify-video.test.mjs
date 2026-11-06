import assert from "node:assert/strict";
import test from "node:test";
import { videoReferences, verifyVideo } from "./verify-video.mjs";
test("video verification requires controls and a public video response", async () => {
	const url = "https://github.com/user-attachments/assets/example";
	assert.deepEqual(videoReferences(`<video controls src="${url}"></video>`), [
		url,
	]);
	assert.throws(() => videoReferences(`<video src="${url}"></video>`));
	assert.throws(() => videoReferences("<p>No recording</p>"));
	let cancelled = false;
	await verifyVideo(url, async () => ({
		ok: true,
		headers: new Headers({ "content-type": "video/webm" }),
		body: {
			cancel: async () => {
				cancelled = true;
			},
		},
	}));
	assert.ok(cancelled);
	await assert.rejects(
		() => verifyVideo(url, async () => ({ ok: false, status: 403 })),
		/public/,
	);
});

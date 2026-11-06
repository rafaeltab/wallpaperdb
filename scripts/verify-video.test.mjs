import { expect } from "vitest";
import { test } from "vitest";
import { videoReferences, verifyVideo } from "./verify-video.mjs";
test("video verification requires controls and a public video response", async () => {
	const url = "https://github.com/user-attachments/assets/example";
	expect(
		videoReferences(`<video controls src="${url}"></video>`),
	).toStrictEqual([url]);
	expect(() => videoReferences(`<video src="${url}"></video>`)).toThrow();
	expect(() => videoReferences("<p>No recording</p>")).toThrow();
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
	expect(cancelled).toBeTruthy();
	await expect(() =>
		verifyVideo(url, async () => ({ ok: false, status: 403 })),
	).rejects.toThrow(/public/);
});

test("rendered private CDN sources are verified through the original public attachment", () => {
	const id = "a3789f14-1d13-4814-84f7-7d661eafae96";
	const publicUrl = `https://github.com/user-attachments/assets/${id}`;
	const html = `<video controls src="https://private-user-images.githubusercontent.com/1/123-${id}.mp4?jwt=signed"></video>`;
	expect(videoReferences(html, publicUrl)).toStrictEqual([publicUrl]);
});

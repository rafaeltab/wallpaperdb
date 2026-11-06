export function videoReferences(html) {
	const urls = [];
	for (const match of html.matchAll(/<video\b([^>]*)>([\s\S]*?)<\/video>/gi)) {
		if (!/(?:^|\s)controls(?:\s|=|$)/i.test(match[1]))
			throw new Error("Video player lacks controls");
		const source = (match[1] + " " + match[2]).match(
			/\bsrc\s*=\s*["']([^"']+)["']/i,
		)?.[1];
		if (!source) throw new Error("Video player lacks a source");
		urls.push(source.replace(/&amp;/g, "&"));
	}
	if (!urls.length) throw new Error("PR body has no rendered video player");
	return urls;
}
export async function verifyVideo(url, request = fetch) {
	const parsed = new URL(url);
	if (
		parsed.origin !== "https://github.com" ||
		!parsed.pathname.startsWith("/user-attachments/assets/")
	)
		throw new Error("Expected a GitHub user attachment URL");
	const response = await request(url, {
		method: "GET",
		redirect: "follow",
		signal: AbortSignal.timeout(15_000),
	});
	try {
		if (!response.ok)
			throw new Error(
				`Video is not publicly accessible: HTTP ${response.status}`,
			);
		if (
			!/^(?:video\/|application\/octet-stream)/i.test(
				response.headers.get("content-type") ?? "",
			)
		)
			throw new Error("Attachment response is not video data");
	} finally {
		await response.body?.cancel();
	}
	return { url, publiclyAccessible: true };
}

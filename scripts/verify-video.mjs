export function videoReferences(html, markdown = "") {
	const urls = [];
	for (const match of html.matchAll(/<video\b([^>]*)>([\s\S]*?)<\/video>/gi)) {
		if (!/(?:^|\s)controls(?:\s|=|$)/i.test(match[1]))
			throw new Error("Video player lacks controls");
		const source = (match[1] + " " + match[2]).match(
			/\bsrc\s*=\s*["']([^"']+)["']/i,
		)?.[1];
		if (!source) throw new Error("Video player lacks a source");
		const decoded = source.replace(/&amp;/g, "&");
		const parsed = new URL(decoded);
		if (
			parsed.origin === "https://github.com" &&
			parsed.pathname.startsWith("/user-attachments/assets/")
		)
			urls.push(decoded);
		else if (
			parsed.origin === "https://private-user-images.githubusercontent.com"
		) {
			const attachment = [
				...markdown.matchAll(
					/https:\/\/github\.com\/user-attachments\/assets\/([a-f0-9-]{36})/gi,
				),
			].find((match) => parsed.pathname.includes(match[1]));
			if (!attachment)
				throw new Error(
					"Rendered video has no matching canonical attachment in the PR body",
				);
			urls.push(attachment[0]);
		} else
			throw new Error("Rendered video does not reference a GitHub attachment");
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

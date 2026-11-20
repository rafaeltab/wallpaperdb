import { writeFile, mkdir } from "node:fs/promises";
import convert from "../../.coverage-experiment/converter.mjs";
export default async function capture(options) {
	if (
		options.coverage.url.endsWith("/src/features/wallpaper-creation/sources.ts")
	) {
		await mkdir("/tmp/wallpaperdb-742/adoption", { recursive: true });
		await writeFile(
			"/tmp/wallpaperdb-742/adoption/web-conversion-input.json",
			JSON.stringify({ ...options, ast: await options.ast }, null, 2),
		);
	}
	return convert(options);
}

import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, vi } from "vitest";

export async function claim(owner) {
	const directory = process.env.STABILITY_DATA;
	const key = process.env.STABILITY_ISOLATED === "1" ? owner : "shared";
	const target = join(directory, key);
	await writeFile(target, owner);
	await writeFile(join(directory, `${owner}.ready`), "ready");
	if (process.env.STABILITY_BARRIER === "1") {
		const other = owner === "a" ? "b" : "a";
		await vi.waitFor(() => readFile(join(directory, `${other}.ready`)), {
			timeout: 1500,
			interval: 5,
		});
	}
	expect(await readFile(target, "utf8")).toBe(owner);
}

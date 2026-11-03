import fs from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";

const input = JSON.parse(
	gunzipSync(fs.readFileSync(new URL("./547-inputs.json.gz", import.meta.url))),
);
export const objects547 = {
	baselineApps: () =>
		Object.entries(input.baseline)
			.filter(([file, item]) => file.startsWith("apps/") && item)
			.map(([file, item]) => ({ path: file, ...item })),
	baselineBlob: (file) => input.baseline[file]?.blob ?? null,
	readBlob: (blob) => {
		const bytes = Buffer.from(input.blobs[blob], "base64");
		if (
			createHash("sha1")
				.update(`blob ${bytes.length}\0`)
				.update(bytes)
				.digest("hex") !== blob
		)
			throw new Error("Controlled frozen blob changed");
		return bytes;
	},
};

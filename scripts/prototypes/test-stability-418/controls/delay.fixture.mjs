import { expect, test } from "vitest";
test("fixed delay misses slower application progress", async () => {
	let ready = false;
	const timer = setTimeout(() => {
		ready = true;
	}, 80);
	try {
		await new Promise((resolve) => setTimeout(resolve, 1));
		expect(ready).toBe(true);
	} finally {
		clearTimeout(timer);
	}
});

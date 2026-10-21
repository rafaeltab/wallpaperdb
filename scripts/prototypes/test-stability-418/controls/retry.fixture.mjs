import { expect, test } from "vitest";
let attempts = 0;
test("fails first attempt then passes retry", { retry: 1 }, () => {
	console.log(`prototype retry attempt ${++attempts}`);
	expect(attempts).toBeGreaterThan(1);
});

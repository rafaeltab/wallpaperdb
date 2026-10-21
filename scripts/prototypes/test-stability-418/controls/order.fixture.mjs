import { expect, test } from "vitest";
let shared;
test("producer initializes shared state", () => {
	shared = "ready";
});
test("consumer depends on a preceding test", () => {
	expect(shared).toBe("ready");
});

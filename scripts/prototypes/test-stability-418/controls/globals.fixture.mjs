import { afterAll, expect, test, vi } from "vitest";
afterAll(() => vi.unstubAllGlobals());
test("reader requires an unpolluted global", () => {
	expect(globalThis.prototype418).toBeUndefined();
});
test("writer leaks a global", () => {
	vi.stubGlobal("prototype418", true);
});

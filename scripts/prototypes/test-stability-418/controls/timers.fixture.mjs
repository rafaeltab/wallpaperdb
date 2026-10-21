import { afterAll, expect, test, vi } from "vitest";
afterAll(() => vi.useRealTimers());
test("reader requires real time", () => {
	expect(vi.isFakeTimers()).toBe(false);
});
test("writer leaks fake time", () => {
	vi.useFakeTimers();
});

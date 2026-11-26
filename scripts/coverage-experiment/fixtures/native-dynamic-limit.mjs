import { expect, it, vi } from "vitest";
it("uses a native dynamic module mock", async () => {
	vi.doMock("./dynamic.js", () => ({ value: "dynamic-mocked" }));
	const value = await import("./dynamic.js");
	expect(value.value).toBe("dynamic-mocked");
});

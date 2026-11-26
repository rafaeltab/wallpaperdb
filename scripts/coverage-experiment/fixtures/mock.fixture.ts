import {
	expect,
	it,
	vi,
} from "../../../apps/user/node_modules/vitest/dist/index.js";
it("uses native module mocks", async () => {
	vi.doMock("./cache.js", () => ({ identity: "mocked" }));
	const value = await import("./cache.js");
	expect(value.identity).toBe("mocked");
});
it("resolves an explicitly imported native mock", async () => {
	vi.doMock("./cache.js", () => ({ identity: "mocked" }));
	const value = await vi.importMock("./cache.js");
	expect(value.identity).toBe("mocked");
});

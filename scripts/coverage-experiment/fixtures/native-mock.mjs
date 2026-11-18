import { expect, it, vi } from "vitest";
vi.mock("./cache.js", () => ({ identity: "mocked" }));
import { identity } from "./cache.js";
it("uses a native static module mock", () => {
	expect(identity).toBe("mocked");
});

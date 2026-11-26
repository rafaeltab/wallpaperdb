import { expect, it, vi } from "vitest";
vi.mock("../../src/coverage-experiment-mock-target.js", () => ({
	original: () => "mocked",
}));
import { original } from "../../src/coverage-experiment-mock-target.js";
it("runs a mock while leaving the original application body unexecuted", () => {
	expect(original()).toBe("mocked");
});
if (process.env.EXPERIMENT_MOCK_ORIGINAL === "1") {
	it("counts an explicitly executed original independently of its mock", async () => {
		const actual = await vi.importActual(
			"../../src/coverage-experiment-mock-target.js",
		);
		expect(actual.original()).toBe("unexecuted-original");
	});
}

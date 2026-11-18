import { expect, it, vi } from "vitest";
vi.mock("../../src/coverage-experiment-auto-target.js", { spy: true });
import {
	executed,
	uncalled,
} from "../../src/coverage-experiment-auto-target.js";
it("executes the autospy wrapper and preserves an uncalled original", async () => {
	expect(executed()).toBe("actual");
	expect(vi.isMockFunction(executed)).toBe(true);
	expect(executed).toHaveBeenCalledTimes(1);
	expect(uncalled).toHaveBeenCalledTimes(0);
	if (process.env.EXPERIMENT_MOCK_ORIGINAL === "1") {
		const original = await vi.importActual(
			"../../src/coverage-experiment-auto-target.js",
		);
		expect(original.executed()).toBe("actual");
	}
});

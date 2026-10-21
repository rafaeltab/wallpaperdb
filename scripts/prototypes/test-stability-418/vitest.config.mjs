import { fileURLToPath } from "node:url";

// No production configuration imports these deliberately invalid controls.
export default {
	test: {
		root: fileURLToPath(new URL(".", import.meta.url)),
		include: ["controls/*.fixture.mjs"],
		testTimeout: 2000,
		hookTimeout: 2000,
		maxWorkers: 1,
		fileParallelism: false,
		retry: 0,
	},
};

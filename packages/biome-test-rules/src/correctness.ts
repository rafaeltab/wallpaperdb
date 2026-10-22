import validExpectRule from "./ported/valid-expect.js";
import validExpectInPromiseRule from "./ported/valid-expect-in-promise.js";
import requireAwaitedExpectPollRule from "./ported/require-awaited-expect-poll.js";
import retryRule from "./retry.js";
import { port } from "./port.js";

export const validExpect = port(validExpectRule, [
	{
		...validExpectRule.meta.defaultOptions[0],
		maxArgs: 2,
	},
]);
export const validExpectInPromise = port(validExpectInPromiseRule);
export const requireAwaitedExpectPoll = port(requireAwaitedExpectPollRule);
export const noTestRetries = port(retryRule);

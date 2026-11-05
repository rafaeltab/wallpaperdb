import validExpectRule from "./ported/valid-expect.ts";
import validExpectInPromiseRule from "./ported/valid-expect-in-promise.ts";
import requireAwaitedExpectPollRule from "./ported/require-awaited-expect-poll.ts";
import retryRule from "./retry.ts";
import { port } from "./port.ts";

export const validExpect = port(validExpectRule, [
	{
		...validExpectRule.meta.defaultOptions[0],
		maxArgs: 2,
	},
]);
export const validExpectInPromise = port(validExpectInPromiseRule);
export const requireAwaitedExpectPoll = port(requireAwaitedExpectPollRule);
export const noTestRetries = port(retryRule);

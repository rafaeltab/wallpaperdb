import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { joinFixture } from './fixtures/join.js';

it('includes the actual shared fenced TypeScript union in initial and review recovery instructions', async () => {
  const f = await joinFixture({
    inProcess: true,
    conflict: true,
    restack: { outcome: 'SIMPLE', review: true },
  });
  try {
    await Effect.runPromise(f.issues.prepare?.(5) ?? Effect.void);
    await Effect.runPromise(f.reopen().prepare?.(5) ?? Effect.void);
    const calls = (await f.host.calls()).filter((call) => ['start', 'send'].includes(call.args[1]));
    expect(calls.map((call) => call.args[1])).toEqual(['start', 'send']);
    for (const call of calls) {
      expect(call.args[3]).toContain('```typescript\ntype AgentResponse =');
      expect(call.args[3]).toContain(
        "kind: 'dependencies'; jobId: string; requireUnimplementedIssues: string[] };\n```"
      );
    }
  } finally {
    await f.close();
  }
});

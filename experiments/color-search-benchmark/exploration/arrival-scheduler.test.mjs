import test from 'node:test';
import assert from 'node:assert/strict';
import { runArrivals, summarizeArrivals } from './arrival-scheduler.mjs';

test('arrival metrics count failed and slow requests instead of only successful latency', () => {
  const result = summarizeArrivals([
    { elapsedMs: 5, schedulerDelayMs: 0 },
    { elapsedMs: 1200, schedulerDelayMs: 100, error: 'timeout' },
  ]);
  assert.equal(result.p95Ms, 1200);
  assert.equal(result.errors, 1);
  assert.equal(result.overOneSecond, 1);
  assert.equal(result.viableAtTestedLoad, false);
});

test('arrivals retain their schedule while a prior request remains pending', async () => {
  let clock = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const result = await runArrivals({ rate: 1000, durationMs: 4, maxInFlight: 1,
    now: () => clock,
    sleep: async amount => { clock += amount; if (clock >= 3) setTimeout(release, 0); },
    run: async () => { await gate; clock += 8; return { queryId: 'slow' }; },
  });
  assert.equal(result.requests, 4);
  assert.equal(result.clientRejected, 3);
  assert.equal(result.peakInFlight, 1);
  assert.equal(result.trials[0].requestMs, 11);
  assert.equal(result.viableAtTestedLoad, false);
});

test('arrival scheduler records request exceptions and rejects invalid configuration', async () => {
  const result = await runArrivals({ rate: 1, durationMs: 1000,
    run: async () => { throw new Error('service failed'); } });
  assert.equal(result.errors, 1);
  assert.match(result.trials[0].error, /service failed/);
  await assert.rejects(runArrivals({ rate: 0, durationMs: 1, run() {} }));
});

test('early timer wakeups never dispatch a request before its scheduled arrival', async () => {
  let clock=0;
  const dispatched=[];
  const result=await runArrivals({rate:100,durationMs:30,now:()=>clock,
    sleep:async amount=>{clock+=amount>1?amount-1:amount;},
    run:async ordinal=>{dispatched.push({ordinal,at:clock});return {};},
  });
  assert.equal(result.requests,3);
  for(const item of dispatched)assert.ok(item.at>=item.ordinal*10,JSON.stringify(item));
});

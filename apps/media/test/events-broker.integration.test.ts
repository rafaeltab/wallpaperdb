import { createDefaultTesterBuilder, DockerTesterBuilder, NatsTesterBuilder } from '@wallpaperdb/test-utils';
import { Effect, ManagedRuntime } from 'effect';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { EventsHealth, NatsBroker, natsEventsLayer } from '../src/adapters/events/index.js';
const Tester = createDefaultTesterBuilder().with(DockerTesterBuilder).with(NatsTesterBuilder).build();
const tester = new Tester().withNats(n => n.withJetstream()).withStream('WALLPAPER');
beforeAll(() => tester.setup());
afterAll(() => tester.destroy());
it('owns a healthy broker connection and closes it when its scope ends', async () => {
 const runtime = ManagedRuntime.make(natsEventsLayer({url: tester.nats.config.endpoints.fromHost,stream:'WALLPAPER',serviceName:'media-test'}));
 const broker = await runtime.runPromise(NatsBroker);
 expect(await runtime.runPromise(Effect.flatMap(EventsHealth, health => health.check()))).toBe(true);
 await runtime.dispose();
 expect(broker.connection.isClosed()).toBe(true);
});

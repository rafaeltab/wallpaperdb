import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  NatsTesterBuilder,
} from '@wallpaperdb/test-utils';
import { Effect, ManagedRuntime } from 'effect';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { natsEventsLayer } from '../src/adapters/events/index.js';
import { ColorEvents, type ExtractionInput } from '../src/extraction/index.js';

const Tester = createDefaultTesterBuilder()
  .with(DockerTesterBuilder)
  .with(NatsTesterBuilder)
  .build();
const tester = new Tester().withNats((nats) => nats.withJetstream()).withStream('WALLPAPER');
beforeAll(() => tester.setup());
afterAll(() => tester.destroy());
const input: ExtractionInput = {
  wallpaperId: 'wallpaper-test',
  fileType: 'image',
  storage: { bucket: 'wallpapers', key: 'test.png' },
  occurrence: { source: 'https://wallpaperdb/ingestor', id: 'uploaded-test' },
  timestamp: '2026-09-24T10:00:00.000Z',
  correlationId: 'workflow-test',
};

it('awaits durable publication and preserves occurrence identity on replay', async () => {
  const runtime = ManagedRuntime.make(
    natsEventsLayer({
      url: tester.nats.config.endpoints.fromHost,
      stream: 'WALLPAPER',
      serviceName: 'events-contract',
    })
  );
  try {
    const publish = Effect.flatMap(ColorEvents, (events) =>
      events.publish({ input, histogram: [1, 0], colorSpace: 'hsv' })
    );
    await runtime.runPromise(publish);
    await runtime.runPromise(publish);
    const manager = await (await tester.nats.getConnection()).jetstreamManager();
    expect((await manager.streams.info('WALLPAPER')).state.messages).toBe(1);
    const message = await manager.streams.getMessage('WALLPAPER', {
      last_by_subj: 'wallpaper.colors.extracted',
    });
    expect(message.json()).toMatchObject({
      specversion: '1.0',
      type: 'wallpaper.colors.extracted',
      time: input.timestamp,
      correlationid: 'workflow-test',
      causationid: input.occurrence.id,
      data: { wallpaperId: input.wallpaperId, colorHistogram: [1, 0], colorSpace: 'hsv' },
    });
  } finally {
    await runtime.dispose();
  }
});
it('reports rejected publication as a typed failure without claiming completion', async () => {
 const runtime=ManagedRuntime.make(natsEventsLayer({url:tester.nats.config.endpoints.fromHost,stream:'WALLPAPER',serviceName:'events-contract'}));
 try {
  const manager=await (await tester.nats.getConnection()).jetstreamManager();
  await manager.streams.update('WALLPAPER',{max_msg_size:1});
  const result=await runtime.runPromise(Effect.flatMap(ColorEvents,events=>events.publish({input:{...input,occurrence:{...input.occurrence,id:'rejected'}},histogram:[1,0],colorSpace:'hsv'})).pipe(Effect.result));
  expect(result._tag).toBe('Failure');
  if(result._tag==='Failure') expect(result.failure).toMatchObject({_tag:'ExtractionUnavailable',operation:'publish-colors'});
 }finally {await runtime.dispose();}
});

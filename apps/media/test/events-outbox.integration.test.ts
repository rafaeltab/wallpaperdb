import { createDefaultTesterBuilder, DockerTesterBuilder, NatsTesterBuilder } from '@wallpaperdb/test-utils';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { natsEventsLayer, natsOutboxLayer, OutboxHealth } from '../src/adapters/events/index.js';
import { CatalogOutbox, CatalogFailure, type AvailableNotification } from '../src/catalog/index.js';
const Tester=createDefaultTesterBuilder().with(DockerTesterBuilder).with(NatsTesterBuilder).build();
const tester=new Tester().withNats(n=>n.withJetstream()).withStream('WALLPAPER');
beforeAll(()=>tester.setup());afterAll(()=>tester.destroy());
it('publishes a stable CloudEvent and retries ambiguous outbox completion without another occurrence',async()=>{
 const pending:AvailableNotification[]=[{id:'out-1',timestamp:'2026-09-24T10:00:00.000Z',causationId:'input-1',causationSource:'https://wallpaperdb/ingestor',correlationId:'flow-1',variant:{wallpaperId:'wp',width:2,height:2,fileSizeBytes:20,format:'image/png',createdAt:'2026-09-24T10:00:00.000Z'}}];
 let completed=0;
 const options={url:tester.nats.config.endpoints.fromHost,stream:'WALLPAPER',serviceName:'outbox-test',outboxPollMs:10};
 const runtime=ManagedRuntime.make(natsOutboxLayer(options).pipe(Layer.provide(natsEventsLayer(options)),Layer.provide(Layer.succeed(CatalogOutbox,{listPending:()=>Effect.succeed(pending.slice()),markPublished:()=>Effect.suspend(()=>{completed++;if(completed===1)return Effect.fail(new CatalogFailure({operation:'mark',cause:'ambiguous response'}));pending.splice(0);return Effect.void;})}))));
 try {
 expect(await runtime.runPromise(Effect.flatMap(OutboxHealth,h=>h.check()))).toBe(true);
 await expect.poll(()=>pending.length).toBe(0);
 const manager=await(await tester.nats.getConnection()).jetstreamManager();
 expect((await manager.streams.info('WALLPAPER')).state.messages).toBe(1);
 const msg=await manager.streams.getMessage('WALLPAPER',{last_by_subj:'wallpaper.variant.available'});
 expect(msg.header.get('ce-specversion')).toBe('1.0');expect(msg.header.get('ce-source')).toBe('https://wallpaperdb/media');expect(msg.header.get('ce-id')).toBe('out-1');expect(msg.header.get('ce-causationid')).toBe('input-1');expect(msg.header.get('ce-correlationid')).toBe('flow-1');
 expect(JSON.parse(new TextDecoder().decode(msg.data))).toEqual({eventId:'out-1',eventType:'wallpaper.variant.available',timestamp:'2026-09-24T10:00:00.000Z',variant:{wallpaperId:'wp',width:2,height:2,aspectRatio:1,fileSizeBytes:20,format:'image/png',createdAt:'2026-09-24T10:00:00.000Z'}});
 expect(completed).toBe(2);
 }finally{await runtime.dispose();}
});

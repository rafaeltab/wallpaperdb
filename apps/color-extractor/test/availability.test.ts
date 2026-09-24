import { Effect, Layer } from 'effect';
import { expect, it } from 'vitest';
import { Availability, AvailabilityProbe, availabilityLayer } from '../src/availability/index.js';
it.each([
  [{s3:true,nats:true,otel:true,consumer:true},'healthy'],
  [{s3:false,nats:true,otel:true,consumer:true},'degraded'],
  [{s3:false,nats:false,otel:false,consumer:false},'unhealthy'],
] as const)('reports dependency health %j', async (checks,status) => {
  const layer=availabilityLayer.pipe(Layer.provide(Layer.succeed(AvailabilityProbe,{inspect:()=>Effect.succeed(checks)})));
  const health=await Effect.runPromise(Effect.gen(function*(){return yield* (yield* Availability).health(false);}).pipe(Effect.provide(layer)));
  expect(health).toMatchObject({status,checks});
});
it('reports shutdown without probing dependencies',async()=>{
  const layer=availabilityLayer.pipe(Layer.provide(Layer.succeed(AvailabilityProbe,{inspect:()=>Effect.die('must not probe')})));
  const health=await Effect.runPromise(Effect.gen(function*(){return yield* (yield* Availability).health(true);}).pipe(Effect.provide(layer)));
  expect(health).toMatchObject({status:'shutting_down',checks:{}});
});

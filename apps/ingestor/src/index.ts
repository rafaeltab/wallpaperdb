import * as NodeRuntime from '@effect/platform-node-shared/NodeRuntime';
import { config as loadEnv } from 'dotenv';
import { ConfigProvider, Effect, Logger } from 'effect';
import { ingestorProgram } from './bootstrap.js';
loadEnv();
NodeRuntime.runMain(
  ingestorProgram.pipe(
    Effect.provide(Logger.layer([Logger.consoleJson])),
    Effect.provideService(
      ConfigProvider.ConfigProvider,
      ConfigProvider.fromEnv({ preserveEmptyStrings: true })
    )
  )
);

import * as NodeRuntime from '@effect/platform-node-shared/NodeRuntime';
import { config as loadEnv } from 'dotenv';
import { Cause, ConfigProvider, Effect, Exit, Logger } from 'effect';
import { gatewayProgram } from './bootstrap.js';

loadEnv();
NodeRuntime.runMain(
  gatewayProgram.pipe(
    Effect.provide(Logger.layer([Logger.consoleJson])),
    Effect.provideService(
      ConfigProvider.ConfigProvider,
      ConfigProvider.fromEnv({ preserveEmptyStrings: true })
    )
  ),
  {
    disableErrorReporting: true,
    teardown: (exit, onExit) =>
      onExit(Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause) ? 0 : 1),
  }
);

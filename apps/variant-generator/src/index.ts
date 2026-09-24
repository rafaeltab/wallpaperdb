import * as NodeRuntime from '@effect/platform-node-shared/NodeRuntime';
import { Effect, Logger } from 'effect';
import { variantGeneratorProgram } from './bootstrap.js';
NodeRuntime.runMain(
  variantGeneratorProgram.pipe(Effect.provide(Logger.layer([Logger.consoleJson])))
);

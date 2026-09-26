import * as NodeRuntime from '@effect/platform-node-shared/NodeRuntime';
import { Cause, Effect, Exit, Logger, Runtime } from 'effect';
import { tagsProgram } from './bootstrap.js';

NodeRuntime.runMain(tagsProgram.pipe(Effect.provide(Logger.layer([Logger.consoleJson]))), {
  teardown: (exit, onExit) => {
    if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) onExit(0);
    else Runtime.defaultTeardown(exit, onExit);
  },
});

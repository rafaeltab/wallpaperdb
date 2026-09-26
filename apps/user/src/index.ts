import * as NodeRuntime from '@effect/platform-node-shared/NodeRuntime';
import { Effect, Logger } from 'effect';
import { userProgram } from './bootstrap.js';
NodeRuntime.runMain(userProgram.pipe(Effect.provide(Logger.layer([Logger.consoleJson]))));

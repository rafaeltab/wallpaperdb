import * as NodeRuntime from '@effect/platform-node-shared/NodeRuntime';
import { Effect, Logger } from 'effect';
import { mediaProgram } from './bootstrap.js';
NodeRuntime.runMain(mediaProgram.pipe(Effect.provide(Logger.layer([Logger.consoleJson]))));

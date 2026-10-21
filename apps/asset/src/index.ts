import * as NodeRuntime from '@effect/platform-node-shared/NodeRuntime';
import { Effect, Logger } from 'effect';
import { assetProgram } from './bootstrap.js';
NodeRuntime.runMain(assetProgram.pipe(Effect.provide(Logger.layer([Logger.consoleJson]))));

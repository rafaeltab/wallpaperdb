import * as NodeRuntime from '@effect/platform-node-shared/NodeRuntime';
import { Effect, Logger } from 'effect';
import { colorExtractorProgram } from './bootstrap.js';
NodeRuntime.runMain(colorExtractorProgram.pipe(Effect.provide(Logger.layer([Logger.consoleJson]))));

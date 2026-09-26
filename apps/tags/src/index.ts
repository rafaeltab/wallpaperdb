import * as NodeRuntime from '@effect/platform-node-shared/NodeRuntime';
import { Effect, Logger } from 'effect';
import { tagsProgram } from './bootstrap.js';

NodeRuntime.runMain(tagsProgram.pipe(Effect.provide(Logger.layer([Logger.consoleJson]))));

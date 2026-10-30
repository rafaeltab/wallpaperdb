import { resolve } from 'node:path';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { z } from 'zod';
import { Execution, Issues, Job, JobLive, JobStore, Time } from '../capabilities/job/index.js';
import { systemTime } from '../adapters/clock/index.js';
import { fileStore } from '../adapters/store/index.js';
import { githubIssues } from '../adapters/github/index.js';
import { t3Execution } from '../adapters/t3/index.js';
import { operationsServer } from '../http/index.js';
import { command } from '../platform/index.js';
import { telemetry } from './telemetry.js';

export async function startFactory(environment: NodeJS.ProcessEnv) {
  const configuration = z
    .object({
      FACTORY_PROJECT: z.string().min(1),
      FACTORY_OTEL_ENDPOINT: z
        .string()
        .url()
        .refine((value) => /^https?:/.test(value))
        .optional(),
      FACTORY_T3_PROJECT_ID: z.string().min(1),
      FACTORY_PR_BASE: z
        .string()
        .regex(/^[A-Za-z0-9][A-Za-z0-9/_.-]*$/)
        .default('main'),
      FACTORY_BASE: z.string().regex(/^[a-f0-9]{40}$/),
      FACTORY_T3_BINARY: z.string().startsWith('/'),
      FACTORY_STATE: z.string().startsWith('/'),
      FACTORY_HOST: z
        .string()
        .ip()
        .default('127.0.0.1')
        .refine(
          (host) =>
            host === '127.0.0.1' ||
            host === '::1' ||
            /^100\.(6[4-9]|[789]\d|1[01]\d|12[0-7])\./.test(host)
        ),
      FACTORY_PORT: z.coerce
        .number()
        .int()
        .min(0)
        .max(65535)
        .refine((port) => port === 0 || port >= 1024)
        .default(9400),
      FACTORY_PREREQUISITES: z
        .string()
        .default('[]')
        .transform((text) => JSON.parse(text))
        .pipe(
          z.array(
            z.object({
              issue: z.number().int().positive(),
              pr: z.number().int().positive(),
              commit: z.string().regex(/^[a-f0-9]{40}$/),
            })
          )
        ),
    })
    .parse(environment);
  const project = resolve(configuration.FACTORY_PROJECT);
  await command('git', ['cat-file', '-e', `${configuration.FACTORY_BASE}^{commit}`], project);
  const help = await command(
    configuration.FACTORY_T3_BINARY,
    ['thread', 'start', '--help'],
    project
  );
  if (!help.includes('--worktree') || !help.includes('--model'))
    throw new Error('T3 installation lacks required headless thread interface');
  const deps = Layer.mergeAll(
    Layer.succeed(Time, systemTime),
    Layer.succeed(JobStore, fileStore(configuration.FACTORY_STATE)),
    Layer.succeed(
      Issues,
      githubIssues({
        project,
        prBase: configuration.FACTORY_PR_BASE,
        base: configuration.FACTORY_BASE,
        prerequisites: configuration.FACTORY_PREREQUISITES,
      })
    ),
    Layer.succeed(
      Execution,
      t3Execution({
        project,
        prBase: configuration.FACTORY_PR_BASE,
        projectId: configuration.FACTORY_T3_PROJECT_ID,
        binary: configuration.FACTORY_T3_BINARY,
      })
    )
  );
  const runtime = ManagedRuntime.make(
    JobLive.pipe(
      Layer.provide(deps),
      Layer.provideMerge(telemetry(configuration.FACTORY_OTEL_ENDPOINT))
    )
  );
  const job = await runtime.runPromise(Job);
  const requests = new AbortController();
  const app = operationsServer({
    base: configuration.FACTORY_BASE,
    job,
    run: (effect) => runtime.runPromise(effect, { signal: requests.signal }),
  });
  try {
    await runtime.runPromise(
      Effect.tryPromise(() =>
        app.listen({ host: configuration.FACTORY_HOST, port: configuration.FACTORY_PORT })
      ).pipe(Effect.withSpan('factory.startup'))
    );
  } catch (cause) {
    try {
      await app.close();
    } finally {
      requests.abort();
      await runtime.dispose();
    }
    throw cause;
  }

  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      const deadline = setTimeout(() => {
        requests.abort();
        app.server.closeAllConnections();
      }, 5000);
      try {
        await app.close();
      } finally {
        clearTimeout(deadline);
        requests.abort();
        await runtime.dispose();
      }
    })());
  return { app, close };
}

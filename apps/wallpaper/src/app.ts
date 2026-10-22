import { Layer } from 'effect';
import { creationLayer } from './capabilities/creation/index.js';
import { workflowPostgresLayer } from './adapters/workflow/index.js';
import { assetWorkflowLayer } from './adapters/asset-workflow/index.js';
import { creatorAuthenticationLayer } from './adapters/creators/index.js';
import { dependencyProbeLayer } from './adapters/dependencies/index.js';
import { availabilityLayer } from './capabilities/availability/index.js';
import type { Config } from './config.js';
import { createHttpApp, registerCreationHttp } from './http/index.js';
import { tracingLayer } from './runtime.js';

interface AppOptions {
  readonly logger?: boolean;
  readonly signal?: AbortSignal;
  readonly otelHealthy?: boolean;
  readonly shutdownTimeoutMs?: number;
}
export function wallpaperLayer(config: Config, options: AppOptions = {}) {
  return availabilityLayer.pipe(
    Layer.provide(
      dependencyProbeLayer({
        databaseUrl: config.databaseUrl,
        natsUrl: config.natsUrl,
        serviceName: config.otelServiceName,
        otelHealthy:
          config.nodeEnv === 'test' || !config.otelEndpoint || options.otelHealthy === true,
      })
    ),
    Layer.provideMerge(tracingLayer)
  );
}
export function createApp(config: Config, options: AppOptions = {}) {
  return createHttpApp(
    { nodeEnv: config.nodeEnv, port: config.port },
    wallpaperLayer(config, options),
    {
      ...options,
      configure: config.workflow
        ? async (app) => {
            const workflow = config.workflow;
            if (!workflow) return;
            const persistence = workflowPostgresLayer({
              ...workflow,
              databaseUrl: config.databaseUrl,
              leaseMs: 30000,
            });
            const creation = creationLayer(workflow.ownerNamespace).pipe(
              Layer.provide(persistence)
            );
            const workers = assetWorkflowLayer({ ...workflow, natsUrl: config.natsUrl }).pipe(
              Layer.provideMerge(creation),
              Layer.provide(persistence)
            );
            const services = Layer.merge(
              workers,
              creatorAuthenticationLayer(workflow.identityProviders)
            ).pipe(Layer.provideMerge(tracingLayer));
            await registerCreationHttp(app, services, { monitorWorkflow: true });
          }
        : undefined,
    }
  );
}

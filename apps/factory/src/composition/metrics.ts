import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { TelemetryExportTransport } from '@wallpaperdb/core/telemetry';
import { Effect, Layer } from 'effect';
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from 'effect/unstable/http';
import { OtlpMetrics, OtlpSerialization } from 'effect/unstable/observability';

/** Metrics borrow the same factory-owned bounded DNS and sockets as tracing. */
export function metricsLayer(endpoint: string, transport: TelemetryExportTransport) {
  const diagnosticRequest = HttpClientRequest.post('http://factory-collector.invalid/v1/metrics');
  const client = HttpClient.make((request, url, signal) =>
    Effect.tryPromise({
      try: async () => {
        const agent = await transport.options.httpAgentOptions(url.protocol);
        if (request.body._tag !== 'Uint8Array') throw new Error('Expected serialized OTLP metrics');
        const body = request.body.body;
        const response = await new Promise<Response>((resolve, reject) => {
          const pending = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
            url,
            {
              method: request.method,
              headers: request.headers,
              agent,
              signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]),
            },
            (response) => {
              response.on('error', reject);
              response.on('end', () =>
                resolve(
                  new Response(null, {
                    status: response.statusCode ?? 500,
                    headers: response.headers['retry-after']
                      ? { 'retry-after': response.headers['retry-after'] }
                      : {},
                  })
                )
              );
              response.resume();
            }
          );
          pending.on('error', reject);
          pending.end(body);
        });
        return HttpClientResponse.fromWeb(diagnosticRequest, response);
      },
      catch: (cause) =>
        new HttpClientError.HttpClientError({
          reason: new HttpClientError.TransportError({
            request: diagnosticRequest,
            cause:
              cause instanceof Error && 'code' in cause
                ? cause.code
                : 'METRICS_TRANSPORT_UNAVAILABLE',
          }),
        }),
    })
  );
  return OtlpMetrics.layer({
    url: `${endpoint.replace(/\/+$/, '')}/v1/metrics`,
    resource: { serviceName: 'wallpaperdb.factory' },
    exportInterval: '10 seconds',
    shutdownTimeout: '1 second',
  }).pipe(
    Layer.provide(OtlpSerialization.layerJson),
    Layer.provide(Layer.succeed(HttpClient.HttpClient, client))
  );
}

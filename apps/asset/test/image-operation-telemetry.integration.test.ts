import { metrics } from '@opentelemetry/api';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { orientationFixture } from '@wallpaperdb/test-utils/fixtures';
import { ManagedRuntime } from 'effect';
import { describe, expect, it } from 'vitest';
import { sharpTransformerLayer } from '../src/adapters/assets/index.js';
import { type AssetBody, ImageTransformer } from '../src/capabilities/delivery/index.js';

function source(bytes: Uint8Array): AssetBody {
  return {
    close() {},
    async *[Symbol.asyncIterator]() {
      yield bytes;
    },
  };
}

describe('native image operation metrics', () => {
  it.each([
    'valid image',
    'corrupt input',
  ] as const)('keeps inspection of %s out of resize measurements', async (input) => {
    const reader = new PeriodicExportingMetricReader({
      exporter: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
      exportIntervalMillis: 600000,
    });
    const provider = new MeterProvider({ readers: [reader] });
    metrics.setGlobalMeterProvider(provider);
    const runtime = ManagedRuntime.make(sharpTransformerLayer({ maxInputPixels: 268435456 }));
    try {
      const original = await orientationFixture('png', 6);
      const resized = await runtime.runPromise(
        ImageTransformer.use((transformer) =>
          transformer.resize(source(original), {
            width: 40,
            fit: 'contain',
            mimeType: 'image/png',
          })
        )
      );
      for await (const _chunk of resized) {
        /* Consume the real native output. */
      }
      const inspection = runtime.runPromise(
        ImageTransformer.use((transformer) =>
          transformer.inspect(
            source(input === 'valid image' ? original : Buffer.from('invalid image'))
          )
        )
      );
      if (input === 'valid image') {
        expect(await inspection).toEqual({ width: 80, height: 120, requiresOrientation: true });
      } else {
        await expect(inspection).rejects.toMatchObject({
          _tag: 'DeliveryUnavailable',
          operation: 'inspect_image',
        });
      }
      await runtime.dispose();
      const { resourceMetrics } = await reader.collect();
      const measurements = resourceMetrics.scopeMetrics.flatMap((scope) => scope.metrics);
      expect(
        measurements.filter((metric) => metric.descriptor.name === 'asset.resize.setup_duration_ms')
      ).toMatchObject([
        {
          dataPoints: [
            {
              attributes: { 'resize.fit_mode': 'contain', 'image.format': 'png' },
              value: { count: 1 },
            },
          ],
        },
      ]);
      expect(
        measurements.filter(
          (metric) => metric.descriptor.name === 'asset.image_inspection.setup_duration_ms'
        )
      ).toMatchObject([{ dataPoints: [{ attributes: {}, value: { count: 1 } }] }]);
      expect(
        measurements.find((metric) => metric.descriptor.name === 'asset.resize.pipeline.errors')
      ).toBeUndefined();
      const errors = measurements.filter(
        (metric) => metric.descriptor.name === 'asset.image_inspection.pipeline.errors'
      );
      if (input === 'valid image') expect(errors).toEqual([]);
      else expect(errors).toMatchObject([{ dataPoints: [{ value: 1 }] }]);
    } finally {
      await runtime.dispose();
      await provider.shutdown();
      metrics.disable();
    }
  });
});

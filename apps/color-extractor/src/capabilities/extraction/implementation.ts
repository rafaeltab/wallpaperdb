import { Effect, Layer } from 'effect';
import type { ExtractionInput } from './contract.js';
import { ColorEvents, ExtractColors, ImageMeasurements } from './contract.js';

export const extractionLayer = Layer.effect(
  ExtractColors,
  Effect.gen(function* () {
    const images = yield* ImageMeasurements;
    const events = yield* ColorEvents;
    return ExtractColors.of({
      extract: Effect.fn('color-extraction.extract')(function* (input: ExtractionInput) {
        if (input.fileType !== 'image') return { _tag: 'Skipped' } as const;
        const measured = yield* images.extract(input.storage);
        yield* events.publish({ input, ...measured });
        return { _tag: 'Extracted' } as const;
      }),
    });
  })
);

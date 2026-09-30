export type {
  ExtractedColors,
  ExtractionInput,
  ExtractionOutcome,
  OriginalImage,
  ColorMeasurements,
  MeasuredImage,
} from './contract.js';
export { ColorEvents, ExtractColors, ExtractionUnavailable, ImageHistogram } from './contract.js';
export { ImageMeasurements } from './contract.js';
export { computeHistogram, extractionLayer } from './implementation.js';

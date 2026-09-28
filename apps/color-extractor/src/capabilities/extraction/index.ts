export type {
  ExtractedColors,
  ExtractionInput,
  ExtractionOutcome,
  OriginalImage,
} from './contract.js';
export { ColorEvents, ExtractColors, ExtractionUnavailable, ImageHistogram } from './contract.js';
export { computeHistogram, extractionLayer } from './implementation.js';

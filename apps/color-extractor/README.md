# Color extractor

Color Extractor describes the visible colors of uploaded wallpapers so users can discover images by color. It reads immutable originals accepted by Ingestor and publishes color histograms for Gateway's catalogue.

## Core capabilities

- Computes normalized HSV histograms, weighting partially transparent pixels by their visibility and ignoring fully transparent pixels.
- Processes image uploads automatically and skips videos.
- Publishes extracted colors durably before marking an upload as processed.
- Retries failed extraction or publication and retains invalid or repeatedly failing messages in quarantine for investigation.

Sharp decodes and resamples images in an isolated process so deadlines and shutdown can stop native image work. NATS JetStream carries upload events and extracted colors between services.

See the [domain context](CONTEXT.md), [decoding isolation decision](docs/adr/0001-isolate-native-image-decoding.md), and [contributor setup](../../CONTRIBUTING.md).

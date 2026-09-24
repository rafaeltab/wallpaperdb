# Variant generator

Generates lower-resolution wallpaper variants so clients can request images suited to their devices.

## Capabilities

- Selects smaller resolution presets that match the original aspect ratio.
- Preserves image proportions and format while applying configured encoding quality.
- Stores and announces each variant for downstream delivery.
- Continues remaining presets after an individual failure and retries incomplete batches without losing successful results.

## Technology choices

Sharp performs image resizing and encoding in an isolated process so deadlines and shutdown can stop native work. NATS JetStream retains generation requests and accepts variant announcements. Object storage holds the original and generated images.

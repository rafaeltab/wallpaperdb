# Media Service

Wallpaper retrieval and on-demand resizing service.

## Documentation

**Complete documentation:** [apps/docs/content/docs/services/media.mdx](../docs/content/docs/services/media.mdx)

Run `make docs-dev` from the repository root to view the rendered documentation site.

## Quick Start

```bash
# Start infrastructure first
make infra-start

# Start media service
make media-dev
```

## Features

- Wallpaper retrieval by ID
- On-demand image resizing (Sharp)
- 3 resize modes (contain, cover, fill)
- CDN-ready caching headers
- Streaming responses

## API

**Retrieve wallpaper:**
```bash
curl http://localhost:3003/wallpapers/wlpr_01HF8XQZJ... > wallpaper.jpg
```

**Resize on-the-fly:**
```bash
curl "http://localhost:3003/wallpapers/wlpr_01HF8XQZJ...?w=800&h=600" > resized.jpg
```

**See the [complete documentation](../docs/content/docs/services/media.mdx) for detailed API reference.**

## Commands

```bash
make media-dev          # Start service in development mode
make media-test         # Run all tests
make media-build        # Build for production
```

**Status:** 🚧 In Progress

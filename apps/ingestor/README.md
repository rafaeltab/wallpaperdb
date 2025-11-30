# Ingestor Service

Production-ready wallpaper upload and validation service.

## Documentation

**Complete documentation:** [apps/docs/content/docs/services/ingestor.mdx](../docs/content/docs/services/ingestor.mdx)

Run `make docs-dev` from the repository root to view the rendered documentation site.

## Quick Start

```bash
# Start infrastructure first
make infra-start

# Start ingestor service
make ingestor-dev
```

## Features

- Multi-format upload (JPEG, PNG, WebP, MP4, WebM)
- 6-state upload workflow (initiated → uploading → stored → processing → completed/failed)
- Content-based deduplication (SHA256)
- 4 reconciliation systems for eventual consistency
- Redis-based rate limiting
- RFC 7807 error handling

## API

**Upload wallpaper:**
```bash
curl -X POST http://localhost:3001/upload \
  -F "file=@wallpaper.jpg" \
  -F "userId=test-user"
```

**Health check:**
```bash
curl http://localhost:3001/health
```

**Swagger UI:**
```
http://localhost:3001/documentation
```

**See the [complete documentation](../docs/content/docs/services/ingestor.mdx) for detailed API reference.**

## Commands

```bash
make ingestor-dev          # Start service in development mode
make ingestor-test         # Run all tests
make ingestor-build        # Build for production
make ingestor-docker-build # Build Docker image
```

**Status:** ✅ Production Ready

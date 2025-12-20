# Services

> **Last Updated**: 2025-11-23

The plan is to construct the system using microservices.
This document describes an overall architecture.

---

## Ingestor ✅ Complete

**Status**: Production-ready

Firstly, users need to upload wallpapers. This can be its own microservice, called the 'ingestor'.
Its sole purpose is to take a wallpaper uploaded by a user, store it, and notify the rest of the system about it.

**Details**: [plans/ingestor.md](./ingestor.md)

---

## Media ✅ Complete

**Status**: Production-ready - [plans/done/media-service.md](./done/media-service.md)

Users must retrieve wallpapers efficiently, the 'media' service exposes wallpapers efficiently to the user.

**Key Design Decisions**:
- Own database (event-driven, no direct access to ingestor DB)
- Serves original files and resizes on-the-fly
- Selects best pre-generated variant (from Variant Generator) when available
- Falls back to original if no variants exist
- Public access (no authentication)

**Dependencies**: Ingestor (publishes `wallpaper.uploaded` events)

---

## Variant Generator ✅ Complete

**Status**: Not started (after Media Service)

Pre-generates common size variants (2K, 1080p, 720p) for uploaded wallpapers.

**Event Flow**:
```
NATS (wallpaper.uploaded) → Variant Generator → MinIO (store variants) → NATS (variant.created)
```

**Dependencies**: Ingestor, Media Service (consumes variants)

---

## Thumbnail Extractor 📋 Planned

**Status**: Not started

Users want to see a long list of wallpapers with minimal loading, transferring a whole video for live wallpapers every time is resource intensive, and unrealistic.
Instead, the 'thumbnail extractor' service extracts thumbnails for live and animated wallpapers.
This service provides these to the system.

---

## Gateway ✅ Complete

**Status**: Not started

A user can retrieve wallpapers, manage their own wallpapers, and several other things.
It's annoying from a UI perspective to talk to several microservices for this, so the 'gateway' service abstracts this.

This service exposes a GraphQL API, and integrates with open search directly to expose information. It can also forward requests to different microservices.

---

## Quality Enrichment 📋 Planned

**Status**: Not started

The user wants to filter wallpapers by quality.
The 'quality enrichment' service extracts quality information from wallpapers, and provides this to the system.

---

## Color Enrichment 📋 Planned

**Status**: Not started

The user wants to filter wallpapers by color.
The 'color enrichment' service extracts color information from wallpapers, and provides this to the system.

---

## Tagging 📋 Planned

**Status**: Not started

The user wants to add tags to wallpapers and filter wallpapers by tags.
The 'tagging' service manage tags for wallpapers, and provides this to the system.

# @wallpaperdb/docs

The documentation site helps people use, operate, and contribute to WallpaperDB. It makes maintained guidance and architectural decisions accessible to both human readers and agents.

## Core capabilities

- Publish user guides, operational recovery procedures, incident records, and historical architecture decisions with navigation and full-text search.
- Direct contributors to the maintained setup guide, coding standards, and domain context map.
- Generate browsable REST references from the Ingestor and Media OpenAPI specifications.
- Export the documentation as a single text response for agents and other tools.

## Technology choices

Fumadocs renders the MDX content and generates REST API reference pages from service OpenAPI specifications. Next.js hosts the site.

# Gateway Service Implementation Plan

**Status:** Not Started
**Decision Date:** 2025-11-30
**Last Updated:** 2025-11-30

---

## 1. Executive Summary

This document outlines the implementation plan for the new **Gateway service**. The Gateway will serve as the primary, read-optimized entry point for all client applications. It will expose a GraphQL API to provide flexible and efficient data querying capabilities.

The **Minimum Viable Product (MVP)** is tightly scoped to focus on what is achievable with the current system architecture. It will exclusively implement filtering of wallpapers based on their available **variants** (resolution, aspect ratio, and format). This data will be sourced from a new `wallpaper.variant.available` event published by the Media service.

Features like color, tag, or text search are explicitly deferred to a future iteration.

---

## 2. Technology Stack

- **Framework:** Fastify
- **Dependency Injection:** TSyringe
- **API Layer:** GraphQL (using the `mercurius` Fastify plugin)
- **Primary Data Store:** OpenSearch
- **Client:** `@opensearch-project/opensearch`
- **Testing:** Vitest with Testcontainers for OpenSearch and NATS.

---

## 3. Architecture

The Gateway service is designed for high read throughput. Its read model is populated asynchronously by events from the NATS event bus.

The data flow for the MVP will be:
1. The **Media service** processes a wallpaper and makes a variant available.
2. The Media service publishes a `wallpaper.variant.available` event to NATS. The event payload will contain the wallpaper ID and details of the new variant (width, height, aspect ratio, format).
3. The **Gateway service** consumes this event.
4. The Gateway's consumer updates a document in its **OpenSearch index**, adding the new variant information to a list of available variants for that wallpaper.
5. A client can then query the Gateway's GraphQL API to find wallpapers that have variants matching specific criteria.

---

## 4. Implementation Plan (TDD-based MVP)

The implementation will follow a Red-Green-Refactor methodology. We will write failing integration tests to define our features before implementing the code to make them pass.

### Step 1: Scaffolding and Initial Setup
- **Goal:** Create the service skeleton and a testable environment.
- **Tasks:**
    - Create the `apps/gateway` directory and standard monorepo configuration files (`package.json`, `tsconfig.json`, `Dockerfile`, etc.).
    - Set up a basic Fastify server with Mercurius.
    - Configure the integration test environment (`vitest.config.ts`) to use Testcontainers for OpenSearch and NATS.

### Step 2: Implement Search (Red-Green Cycle)
- **Goal:** Build the core feature of searching for wallpapers by their variant properties.
- **Tasks:**
    1. **[RED] Write Failing Search Test:** Create an integration test that attempts to query the GraphQL API for a wallpaper with a specific resolution (e.g., 1920x1080). Manually seed the test OpenSearch container with a matching document. This test will fail as the API doesn't exist.
    2. **[GREEN] Implement Schema and Resolver:**
        - Define the GraphQL schema with `Wallpaper`, `Variant`, and `PageInfo` types.
        - The `searchWallpapers` query will accept variant filters (`width`, `height`, `aspectRatio`, `format`) and use cursor-based pagination.
        - Implement the resolver logic to build and execute the correct OpenSearch query (using a `nested` query on the `variants` field).
        - Run the test until it passes.

### Step 3: Implement Event Ingestion (Red-Green Cycle)
- **Goal:** Enable the service to receive data from the Media service via NATS.
- **Tasks:**
    1. **[RED] Write Failing Ingestion Test:** Create an integration test that publishes a mock `wallpaper.variant.available` event to the test NATS container. The test will then check the test OpenSearch container to assert that a corresponding wallpaper document was *not* created/updated, causing it to fail.
    2. **[GREEN] Implement NATS Consumer:**
        - Create a NATS consumer that subscribes to the `wallpaper.variant.available` topic.
        - Implement the handler logic to parse the event and update the OpenSearch index with the new variant data.
        - Run the test until it passes.

### Step 4: Refactor
- **Goal:** Clean up the implementation and improve code quality.
- **Tasks:**
    - Review the new code for clarity, consistency, and adherence to project patterns.
    - Add comments where logic is complex.
    - Ensure all tests are stable and reliable.

---

## 5. Future Work

Once this focused MVP is complete, it provides a solid foundation for the following features:
- **Enrichment Services Integration:** As new services (Color, Tagging, Quality) are built, the Gateway can consume their events to add more data to the OpenSearch documents.
- **Expanded Filtering:** The GraphQL API can be extended with filters for these new attributes.
- **Advanced Search:** Implement vector search for colors.
- **Mutations & Auth:** Add user authentication and GraphQL mutations for user-specific actions.

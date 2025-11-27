import "reflect-metadata";
import { writeFile } from "node:fs/promises";
import { registerOpenAPI } from "@wallpaperdb/core/openapi";
import Fastify from "fastify";
import { container } from "tsyringe";
import { registerRoutes } from "./routes/index.js";

async function generateSwagger(): Promise<string> {
    container.register("config", {
        useValue: {},
    });

    // Create Fastify server
    const fastify = Fastify({
        logger: false,
    });

    fastify.decorate("container", container);

    // Register OpenAPI documentation
    await registerOpenAPI(fastify, {
        title: "WallpaperDB Media API",
        version: "1.0.0",
        description:
            "Wallpaper retrieval and serving service. Retrieves wallpapers from object storage with optional resizing and format conversion.",
        servers: [
            {
                url: `http://localhost:3003`,
                description: "Local development server",
            },
        ],
    });

    // Register all routes
    await registerRoutes(fastify);

    await fastify.ready();

    const swagger = fastify.swagger();

    try {
        await fastify.close();
    } catch (_) { }

    return JSON.stringify(swagger, null, 2);
}

const swagger = await generateSwagger();

writeFile("swagger.json", swagger);

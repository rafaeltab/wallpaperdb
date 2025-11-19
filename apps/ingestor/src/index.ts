import "reflect-metadata";
import type { FastifyInstance } from "fastify";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { startScheduler, stopScheduler } from "./services/scheduler.service.js";

// Load configuration
const config = loadConfig();

// Graceful shutdown handler
async function gracefulShutdown(signal: string, fastify: FastifyInstance) {
    fastify.log.info(`Received ${signal}, starting graceful shutdown...`);

    try {
        // Stop scheduler first to prevent new reconciliation cycles
        stopScheduler();

        await fastify.close();
        fastify.log.info("Graceful shutdown complete");
        process.exit(0);
    } catch (error) {
        fastify.log.error({ err: error }, "Error during graceful shutdown");
        process.exit(1);
    }
}

// Start the server
async function start() {
    try {
        const fastify = await createApp(config);

        // Register shutdown handlers
        process.on("SIGTERM", () => gracefulShutdown("SIGTERM", fastify));
        process.on("SIGINT", () => gracefulShutdown("SIGINT", fastify));

        // Start Fastify server
        await fastify.listen({
            port: config.port,
            host: "0.0.0.0",
        });

        fastify.log.info(`Server is running on port ${config.port}`);
        fastify.log.info(
            `Health check available at http://localhost:${config.port}/health`,
        );
        fastify.log.info(
            `Readiness check available at http://localhost:${config.port}/ready`,
        );

        // Start reconciliation scheduler
        startScheduler();
        fastify.log.info("Reconciliation scheduler started");
    } catch (error) {
        console.error("Failed to start server:", error);
        process.exit(1);
    }
}

// Start the application
start();

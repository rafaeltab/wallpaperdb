import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { MediaService } from "../services/media.service.js";

interface WallpaperParams {
	id: string;
}

/**
 * Register media routes for wallpaper retrieval.
 */
export async function registerMediaRoutes(fastify: FastifyInstance) {
	const mediaService = fastify.container.resolve(MediaService);

	/**
	 * GET /wallpapers/:id
	 * Retrieve a wallpaper file
	 */
	fastify.get<{ Params: WallpaperParams }>(
		"/wallpapers/:id",
		async (request: FastifyRequest<{ Params: WallpaperParams }>, reply: FastifyReply) => {
			const { id } = request.params;

			// Retrieve wallpaper
			const result = await mediaService.getWallpaper(id);

			if (!result) {
				// Return RFC 7807 problem details
				return reply.status(404).type("application/problem+json").send({
					type: "https://wallpaperdb.dev/problems/not-found",
					title: "Wallpaper Not Found",
					status: 404,
					detail: `Wallpaper with ID '${id}' was not found or file is missing from storage`,
					instance: `/wallpapers/${id}`,
				});
			}

			// Set response headers
			reply.type(result.mimeType);
			reply.header("Content-Length", result.fileSizeBytes);
			reply.header("Cache-Control", "public, max-age=31536000, immutable");

			// Stream the file
			return reply.send(result.stream);
		},
	);
}

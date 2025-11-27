import { inject, injectable } from "tsyringe";
import { withSpan, Attributes, recordCounter, recordHistogram } from "@wallpaperdb/core/telemetry";
import { VariantRepository } from "../repositories/variant.repository.js";
import type { Wallpaper } from "../db/schema.js";

export interface SelectionResult {
	source: "original" | "variant";
	storageKey: string;
	storageBucket: string;
	width: number;
	height: number;
	mimeType: string;
	variantId?: string;
}

/**
 * Service for intelligent variant selection.
 * Chooses the optimal source file (original or variant) for resizing.
 */
@injectable()
export class VariantSelectorService {
	constructor(
		@inject(VariantRepository)
		private readonly variantRepository: VariantRepository,
	) {}

	/**
	 * Select the best source file for a resize operation.
	 *
	 * Selection algorithm:
	 * 1. If no resize requested → return original
	 * 2. Calculate effective dimensions (handle width-only or height-only)
	 * 3. Check for upscaling → return original if needed
	 * 4. Query for smallest suitable variant
	 * 5. If variant found → use variant, else → use original
	 *
	 * @param wallpaper - The wallpaper metadata
	 * @param options - Resize options (width, height, fit)
	 * @returns Selection result with source file details
	 */
	async selectSource(
		wallpaper: Wallpaper,
		options?: {
			width?: number;
			height?: number;
			fit: "contain" | "cover" | "fill";
		},
	): Promise<SelectionResult> {
		return await withSpan(
			"media.variant_selection",
			{
				[Attributes.WALLPAPER_ID]: wallpaper.id,
				[Attributes.FILE_WIDTH]: wallpaper.width,
				[Attributes.FILE_HEIGHT]: wallpaper.height,
				[Attributes.RESIZE_WIDTH]: options?.width,
				[Attributes.RESIZE_HEIGHT]: options?.height,
				[Attributes.RESIZE_FIT_MODE]: options?.fit,
			},
			async (span) => {
				// No resize requested - use original
				if (!options?.width && !options?.height) {
					span.setAttribute(Attributes.VARIANT_SELECTION_RESULT, "no_resize");

					recordCounter("media.variant_selection.total", 1, {
						result: "no_resize",
					});

					return {
						source: "original",
						storageKey: wallpaper.storageKey,
						storageBucket: wallpaper.storageBucket,
						width: wallpaper.width,
						height: wallpaper.height,
						mimeType: wallpaper.mimeType,
					};
				}

				// Calculate effective dimensions
				// For width-only or height-only requests, we need both dimensions to query variants
				const requestedWidth = options.width || wallpaper.width;
				const requestedHeight = options.height || wallpaper.height;

				span.setAttribute("effective_width", requestedWidth);
				span.setAttribute("effective_height", requestedHeight);

				// Check for upscaling - never upscale from original
				// (Note: fit=fill mode allows upscaling, but we still prefer not to)
				const wouldUpscale =
					options.fit !== "fill" &&
					(requestedWidth > wallpaper.width ||
						requestedHeight > wallpaper.height);

				if (wouldUpscale) {
					// Would need to upscale - return original
					span.setAttribute(
						Attributes.VARIANT_SELECTION_RESULT,
						"upscale_avoided",
					);

					recordCounter("media.variant_selection.total", 1, {
						result: "upscale_avoided",
					});

					return {
						source: "original",
						storageKey: wallpaper.storageKey,
						storageBucket: wallpaper.storageBucket,
						width: wallpaper.width,
						height: wallpaper.height,
						mimeType: wallpaper.mimeType,
					};
				}

				// Try to find a suitable variant
				const variant = await this.variantRepository.findSmallestSuitable(
					wallpaper.id,
					requestedWidth,
					requestedHeight,
				);

				if (variant) {
					// VARIANT HIT - Found suitable variant
					span.setAttribute(Attributes.VARIANT_SELECTION_RESULT, "hit");
					span.setAttribute(Attributes.VARIANT_ID, variant.id);
					span.setAttribute(Attributes.RESIZE_SOURCE, "variant");

					// Calculate efficiency (how much smaller is variant vs original)
					const originalPixels = wallpaper.width * wallpaper.height;
					const variantPixels = variant.width * variant.height;
					const efficiencyPercent =
						((1 - variantPixels / originalPixels) * 100).toFixed(2);

					span.setAttribute(
						"variant.efficiency_percent",
						Number.parseFloat(efficiencyPercent),
					);

					recordCounter("media.variant_selection.total", 1, {
						result: "hit",
					});

					recordHistogram(
						"media.variant_selection.efficiency_percent",
						Number.parseFloat(efficiencyPercent),
						{
							[Attributes.WALLPAPER_ID]: wallpaper.id,
						},
					);

					// Found a suitable variant - use it
					return {
						source: "variant",
						storageKey: variant.storageKey,
						storageBucket: wallpaper.storageBucket, // Variants use same bucket
						width: variant.width,
						height: variant.height,
						mimeType: wallpaper.mimeType, // Variants have same MIME type as original
						variantId: variant.id,
					};
				}

				// VARIANT MISS - No suitable variant
				span.setAttribute(Attributes.VARIANT_SELECTION_RESULT, "miss");
				span.setAttribute(Attributes.RESIZE_SOURCE, "original");

				recordCounter("media.variant_selection.total", 1, {
					result: "miss",
				});

				// No suitable variant - fall back to original
				return {
					source: "original",
					storageKey: wallpaper.storageKey,
					storageBucket: wallpaper.storageBucket,
					width: wallpaper.width,
					height: wallpaper.height,
					mimeType: wallpaper.mimeType,
				};
			},
		);
	}
}

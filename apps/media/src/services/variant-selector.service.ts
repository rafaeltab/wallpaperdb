import { inject, injectable } from "tsyringe";
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
		// No resize requested - use original
		if (!options?.width && !options?.height) {
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

		// Check for upscaling - never upscale from original
		// (Note: fit=fill mode allows upscaling, but we still prefer not to)
		const wouldUpscale =
			options.fit !== "fill" &&
			(requestedWidth > wallpaper.width || requestedHeight > wallpaper.height);

		if (wouldUpscale) {
			// Would need to upscale - return original
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

		// No suitable variant - fall back to original
		return {
			source: "original",
			storageKey: wallpaper.storageKey,
			storageBucket: wallpaper.storageBucket,
			width: wallpaper.width,
			height: wallpaper.height,
			mimeType: wallpaper.mimeType,
		};
	}
}

import { injectable } from 'tsyringe';
import { withSpanSync, Attributes, recordCounter } from '@wallpaperdb/core/telemetry';
import {
  ASPECT_RATIO_CATEGORIES,
  RESOLUTION_PRESETS,
  type AspectRatioCategory,
  type ResolutionPreset,
} from '../config.js';

/**
 * Service for matching wallpaper aspect ratios to resolution presets.
 * Determines which variants should be generated based on the original dimensions.
 */
@injectable()
export class ResolutionMatcherService {
  /**
   * Match a wallpaper's dimensions to an aspect ratio category.
   *
   * @param width - Original wallpaper width
   * @param height - Original wallpaper height
   * @returns The matching category name, or null if no category matches
   */
  matchAspectRatioCategory(width: number, height: number): AspectRatioCategory | null {
    return withSpanSync(
      'variant-generator.match_aspect_ratio',
      {
        [Attributes.FILE_WIDTH]: width,
        [Attributes.FILE_HEIGHT]: height,
      },
      (span) => {
        const aspectRatio = width / height;
        span.setAttribute('aspect_ratio', aspectRatio);

        for (const [category, config] of Object.entries(ASPECT_RATIO_CATEGORIES)) {
          // Tolerance is a percentage of the target ratio
          const toleranceValue = config.ratio * config.tolerance;
          if (Math.abs(aspectRatio - config.ratio) <= toleranceValue) {
            span.setAttribute('matched_category', category);
            recordCounter('variant_generator.aspect_ratio_matches', 1, {
              category,
            });
            return category as AspectRatioCategory;
          }
        }

        span.setAttribute('matched_category', 'none');
        recordCounter('variant_generator.aspect_ratio_no_match', 1, {
          aspect_ratio: aspectRatio.toFixed(2),
        });
        return null;
      }
    );
  }

  /**
   * Get the list of resolution presets applicable to a wallpaper.
   * Only returns presets that are smaller than the original dimensions.
   *
   * @param origWidth - Original wallpaper width
   * @param origHeight - Original wallpaper height
   * @returns Array of resolution presets to generate (may be empty)
   */
  getApplicablePresets(origWidth: number, origHeight: number): ResolutionPreset[] {
    return withSpanSync(
      'variant-generator.get_applicable_presets',
      {
        [Attributes.FILE_WIDTH]: origWidth,
        [Attributes.FILE_HEIGHT]: origHeight,
      },
      (span) => {
        const category = this.matchAspectRatioCategory(origWidth, origHeight);

        if (!category) {
          span.setAttribute('presets_count', 0);
          span.setAttribute('skip_reason', 'no_matching_category');
          return [];
        }

        const presets = RESOLUTION_PRESETS[category];

        // Filter to presets smaller than original
        const applicable = presets.filter((p) => p.width < origWidth && p.height < origHeight);

        span.setAttribute('category', category);
        span.setAttribute('total_presets', presets.length);
        span.setAttribute('applicable_presets', applicable.length);
        span.setAttribute(
          'preset_labels',
          applicable.map((p) => p.label).join(', ')
        );

        recordCounter('variant_generator.presets_selected', applicable.length, {
          category,
        });

        return applicable;
      }
    );
  }
}

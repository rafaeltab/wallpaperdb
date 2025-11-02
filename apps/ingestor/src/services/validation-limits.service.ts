/**
 * Validation limits for file uploads.
 * These limits are user-specific to support future subscription tiers.
 */
export interface ValidationLimits {
  maxFileSizeImage: number;    // bytes
  maxFileSizeVideo: number;    // bytes
  minWidth: number;             // pixels
  minHeight: number;            // pixels
  maxWidth: number;             // pixels
  maxHeight: number;            // pixels
  allowedFormats: string[];     // MIME types
}

/**
 * Service interface for retrieving user-specific validation limits.
 * Future implementations can fetch from database/API for subscription-based limits.
 */
export interface ValidationLimitsService {
  getLimitsForUser(userId: string): Promise<ValidationLimits>;
}

/**
 * Default implementation that returns the same limits for all users.
 * This is used until we implement subscription-based limits.
 */
export class DefaultValidationLimitsService implements ValidationLimitsService {
  async getLimitsForUser(_userId: string): Promise<ValidationLimits> {
    return {
      maxFileSizeImage: 50 * 1024 * 1024,      // 50MB
      maxFileSizeVideo: 200 * 1024 * 1024,     // 200MB
      minWidth: 1280,
      minHeight: 720,
      maxWidth: 7680,
      maxHeight: 4320,
      allowedFormats: [
        'image/jpeg',
        'image/png',
        'image/webp',
        'video/webm',
        'video/mp4'
      ]
    };
  }
}

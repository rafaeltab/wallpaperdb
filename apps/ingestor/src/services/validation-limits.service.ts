import type { User } from '@wallpaperdb/auth';
import { injectable } from 'tsyringe';

export interface ValidationLimits {
  maxFileSizeImage: number;
  maxFileSizeVideo: number;
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
  allowedFormats: string[];
}

export interface ValidationLimitsService {
  getLimitsForUser(user: User): Promise<ValidationLimits>;
}

@injectable()
export class DefaultValidationLimitsService implements ValidationLimitsService {
  async getLimitsForUser(_user: User): Promise<ValidationLimits> {
    return {
      maxFileSizeImage: 50 * 1024 * 1024, // 50MB
      maxFileSizeVideo: 200 * 1024 * 1024, // 200MB (reserved for future use)
      minWidth: 1280,
      minHeight: 720,
      maxWidth: 7680,
      maxHeight: 4320,
      allowedFormats: [
        'image/jpeg',
        'image/png',
        'image/webp',
        // TODO: Add video support when FFmpeg integration is complete
        // 'video/webm',
        // 'video/mp4'
      ],
    };
  }
}

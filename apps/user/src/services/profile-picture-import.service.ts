import { and, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import { inject, singleton } from 'tsyringe';
import { ulid } from 'ulid';
import type { Config } from '../config.js';
import { DatabaseConnection } from '../connections/database.js';
import { profilePictureImports } from '../db/schema.js';
import { ProfilePictureIngestionService } from './profile-picture-ingestion.service.js';
import { InvalidProfilePictureError, ProfilePictureTooLargeError } from './profile-picture-processing.js';
import { downloadInitialPicture, PermanentPictureImportError } from './profile-picture-source.js';
import { ProfileService } from './profile.service.js';

@singleton()
export class ProfilePictureImportService {
  constructor(
    @inject(DatabaseConnection) private readonly database: DatabaseConnection,
    @inject(ProfilePictureIngestionService) private readonly ingestion: ProfilePictureIngestionService,
    @inject(ProfileService) private readonly profiles: ProfileService,
    @inject('config') private readonly config: Config
  ) {}

  async importPending(): Promise<void> {
    const now = new Date();
    const db = this.database.getClient().db;
    const due = and(inArray(profilePictureImports.status, ['pending', 'retrying']), lte(profilePictureImports.nextAttemptAt, now), or(isNull(profilePictureImports.leaseUntil), lte(profilePictureImports.leaseUntil, now)));
    const jobs = await db.query.profilePictureImports.findMany({ where: due, columns: { profileId: true }, orderBy: [profilePictureImports.nextAttemptAt, profilePictureImports.profileId], limit: 100 });
    for (const candidate of jobs) {
      const job = await db.transaction(async (tx) => {
        const [current] = await tx.select().from(profilePictureImports).where(and(eq(profilePictureImports.profileId, candidate.profileId), due)).for('update', { skipLocked: true });
        if (!current?.sourceUrl) return undefined;
        const leaseToken = ulid();
        await tx.update(profilePictureImports).set({ attempts: current.attempts + 1, leaseToken, leaseUntil: new Date(now.getTime() + this.config.profilePictureImportTimeoutMs + 60_000) }).where(eq(profilePictureImports.profileId, current.profileId));
        return { ...current, leaseToken };
      });
      if (!job?.sourceUrl) continue;
      try {
        const bytes = await downloadInitialPicture(job.sourceUrl, { maxBytes: this.config.profilePictureMaxBytes, timeoutMs: this.config.profilePictureImportTimeoutMs, allowedHosts: this.config.profilePictureImportHosts });
        const assetId = await this.ingestion.stage(job.profileId, bytes);
        await this.profiles.adoptPicture(job.profileId, assetId, undefined, job.leaseToken);
      } catch (error) {
        // Never retain or report transport exceptions: they may contain the captured private URL.
        const delay = Math.min(3_600_000, 1_000 * 2 ** Math.min(job.attempts, 12));
        const permanent = error instanceof PermanentPictureImportError || error instanceof InvalidProfilePictureError || error instanceof ProfilePictureTooLargeError;
        await db.update(profilePictureImports).set({ status: permanent ? 'complete' : 'retrying', sourceUrl: permanent ? null : job.sourceUrl, nextAttemptAt: new Date(Date.now() + delay), leaseToken: null, leaseUntil: null }).where(and(eq(profilePictureImports.profileId, job.profileId), eq(profilePictureImports.leaseToken, job.leaseToken)));
      }
    }
  }
}

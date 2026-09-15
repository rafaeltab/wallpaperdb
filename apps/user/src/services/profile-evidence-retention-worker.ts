import { SystemTimerService, type TimerService } from '@wallpaperdb/core/timer';

type CleanupBatch = (now: Date, isStopping: () => boolean) => Promise<{ deleted: number; failed: number }>;

export class ProfileEvidenceRetentionWorker {
  private interval: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private stopping = false;

  constructor(
    private readonly cleanupEvents: CleanupBatch,
    private readonly cleanupPictures: CleanupBatch,
    private readonly logger: { info(bindings: object, message: string): void; error(bindings: object, message: string): void },
    private readonly timer: TimerService = new SystemTimerService()
  ) {}

  start(): void {
    if (this.interval) return;
    this.stopping = false;
    const run = () => this.cleanupPending().catch((error: unknown) => {
      this.logger.error({ err: error }, 'Profile evidence cleanup cycle failed');
    });
    void run();
    this.interval = this.timer.setInterval(run, 1000);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.interval) this.timer.clearInterval(this.interval);
    this.interval = null;
    await this.inFlight?.catch(() => {});
  }

  cleanupPending(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.cleanupBatch().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async cleanupBatch(): Promise<void> {
    const now = new Date();
    const events = await this.runCleanup(this.cleanupEvents, 'profile-event-retention', now);
    const pictures = await this.runCleanup(this.cleanupPictures, 'profile-picture-retention', now);
    if (events.deleted || pictures.deleted || events.failed || pictures.failed) {
      this.logger.info({ eventsDeleted: events.deleted, picturesDeleted: pictures.deleted, failed: events.failed + pictures.failed }, 'Profile evidence cleanup completed');
    }
  }

  private async runCleanup(cleanup: CleanupBatch, category: string, now: Date): Promise<{ deleted: number; failed: number }> {
    try {
      return await cleanup(now, () => this.stopping);
    } catch {
      this.logger.error({ category }, 'Profile evidence cleanup scan failed; will retry');
      return { deleted: 0, failed: 1 };
    }
  }
}

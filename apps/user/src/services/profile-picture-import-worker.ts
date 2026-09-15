import { SystemTimerService, type TimerService } from '@wallpaperdb/core/timer';

interface ImportLogger {
  error(bindings: object, message: string): void;
}

export class ProfilePictureImportWorker {
  private interval: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private stopping = false;

  constructor(
    private readonly runImportBatch: () => Promise<void>,
    private readonly logger: ImportLogger,
    private readonly timer: TimerService = new SystemTimerService()
  ) {}

  start(): void {
    if (this.interval) return;
    this.stopping = false;
    const run = () => this.importPending().catch(() => {});
    void run();
    this.interval = this.timer.setInterval(run, 1000);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.interval) this.timer.clearInterval(this.interval);
    this.interval = null;
    // The cycle reports its own failure; shutdown must still close dependencies.
    await this.inFlight?.catch(() => {});
  }

  importPending(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runImportBatch()
      .catch((error: unknown) => {
        this.logger.error({ category: 'profile-picture-import' }, 'Profile picture import cycle failed');
        throw error;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }
}

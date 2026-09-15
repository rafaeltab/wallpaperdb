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
    void this.importPending();
    this.interval = this.timer.setInterval(() => this.importPending(), 1000);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.interval) this.timer.clearInterval(this.interval);
    this.interval = null;
    await this.inFlight;
  }

  importPending(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runImportBatch().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }
}

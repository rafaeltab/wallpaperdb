import { SystemTimerService, type TimerService } from '@wallpaperdb/core/timer';

interface ImportLogger {
  error(bindings: object, message: string): void;
}

export class ProfilePictureImportWorker {
  private interval: NodeJS.Timeout | null = null;

  constructor(
    private readonly runImportBatch: () => Promise<void>,
    private readonly logger: ImportLogger,
    private readonly timer: TimerService = new SystemTimerService()
  ) {}

  start(): void {
    void this.importPending();
    this.interval = this.timer.setInterval(() => this.importPending(), 1000);
  }

  async stop(): Promise<void> {
    if (this.interval) this.timer.clearInterval(this.interval);
    this.interval = null;
  }

  async importPending(): Promise<void> {
    await this.runImportBatch();
  }
}

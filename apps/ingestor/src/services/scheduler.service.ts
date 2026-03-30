import { inject, singleton } from 'tsyringe';
import type { TimerService } from '@wallpaperdb/core/timer';
import { StuckUploadsReconciliation } from './reconciliation/stuck-uploads-reconciliation.service.js';
import { MissingEventsReconciliation } from './reconciliation/missing-events-reconciliation.service.js';
import { OrphanedIntentsReconciliation } from './reconciliation/orphaned-intents-reconciliation.service.js';
import { OrphanedMinioReconciliation } from './reconciliation/orphaned-minio-reconciliation.service.js';

/**
 * Scheduler service for running background reconciliation tasks.
 *
 * Manages two intervals:
 * - Reconciliation cycle: Runs stuck uploads, missing events, and orphaned intents reconciliation
 * - MinIO cleanup cycle: Removes orphaned objects from MinIO storage
 *
 * Timer calls are delegated to an injected TimerService so that tests can
 * substitute FakeTimerService and advance time deterministically without
 * touching global setInterval (which would freeze database/NATS drivers).
 */
@singleton()
export class SchedulerService {
  private reconciliationInterval: NodeJS.Timeout | null = null;
  private minioCleanupInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isReconciling = false;

  constructor(
    @inject('TimerService') private readonly timerService: TimerService,
    @inject('reconciliationIntervalMs') private readonly reconciliationIntervalMs: number,
    @inject('minioCleanupIntervalMs') private readonly minioCleanupIntervalMs: number,
    @inject(StuckUploadsReconciliation)
    private readonly stuckUploadsReconciliation: StuckUploadsReconciliation,
    @inject(MissingEventsReconciliation)
    private readonly missingEventsReconciliation: MissingEventsReconciliation,
    @inject(OrphanedIntentsReconciliation)
    private readonly orphanedIntentsReconciliation: OrphanedIntentsReconciliation,
    @inject(OrphanedMinioReconciliation)
    private readonly orphanedMinioReconciliation: OrphanedMinioReconciliation
  ) {}

  /**
   * Start the reconciliation scheduler.
   * Runs reconciliation every reconciliationIntervalMs milliseconds.
   * Runs MinIO cleanup every minioCleanupIntervalMs milliseconds.
   */
  start(): void {
    if (this.isRunning) {
      console.log('Scheduler already running, ignoring start request');
      return;
    }

    console.log('Starting reconciliation scheduler...');

    // Run reconciliation on regular interval
    this.reconciliationInterval = this.timerService.setInterval(() => {
      return this.runReconciliationCycle().catch((error) => {
        console.error('Fatal error in reconciliation interval:', error);
      });
    }, this.reconciliationIntervalMs);

    // Run MinIO cleanup on separate interval
    this.minioCleanupInterval = this.timerService.setInterval(() => {
      return this.runMinioCleanupCycle().catch((error) => {
        console.error('Fatal error in MinIO cleanup interval:', error);
      });
    }, this.minioCleanupIntervalMs);

    this.isRunning = true;
    console.log(
      `Scheduler started (reconciliation: ${this.reconciliationIntervalMs}ms, MinIO cleanup: ${this.minioCleanupIntervalMs}ms)`
    );
  }

  /**
   * Stop the reconciliation scheduler
   * Called during graceful shutdown
   */
  stop(): void {
    if (!this.isRunning) {
      console.log('Scheduler not running, nothing to stop');
      return;
    }

    console.log('Stopping reconciliation scheduler...');

    if (this.reconciliationInterval) {
      this.timerService.clearInterval(this.reconciliationInterval);
      this.reconciliationInterval = null;
    }

    if (this.minioCleanupInterval) {
      this.timerService.clearInterval(this.minioCleanupInterval);
      this.minioCleanupInterval = null;
    }

    this.isRunning = false;
    console.log('Scheduler stopped');
  }

  /**
   * Stop the scheduler and wait for current cycle to complete
   * Use this in tests or during graceful shutdown
   */
  async stopAndWait(): Promise<void> {
    this.stop();

    // Wait for any in-progress reconciliation to complete.
    // setImmediate yields to the event loop (draining pending microtasks/I/O)
    // without adding real wall-clock time, keeping tests fast.
    while (this.isReconciling) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  /**
   * Run reconciliation immediately (for testing or admin trigger)
   * This can be called independently of the scheduler
   */
  async runReconciliationNow(): Promise<void> {
    console.log('Running manual reconciliation...');
    await this.runReconciliationCycle();
    console.log('Manual reconciliation complete');
  }

  /**
   * Run MinIO cleanup immediately (for testing or admin trigger)
   * This can be called independently of the scheduler
   */
  async runMinioCleanupNow(): Promise<void> {
    console.log('Running manual MinIO cleanup...');
    await this.runMinioCleanupCycle();
    console.log('Manual MinIO cleanup complete');
  }

  /**
   * Execute a single reconciliation cycle
   * Runs all reconciliation functions sequentially
   */
  private async runReconciliationCycle(): Promise<void> {
    // Prevent concurrent reconciliation cycles
    if (this.isReconciling) {
      console.log('Reconciliation cycle already in progress, skipping...');
      return;
    }

    this.isReconciling = true;

    try {
      console.log('Starting reconciliation cycle...');

      // Run all reconciliation functions sequentially
      // Each function handles its own errors internally, but we catch any unexpected ones

      try {
        await this.stuckUploadsReconciliation.reconcile();
      } catch (error) {
        console.error('Error in reconcileStuckUploads:', error);
      }

      try {
        await this.missingEventsReconciliation.reconcile();
      } catch (error) {
        console.error('Error in reconcileMissingEvents:', error);
      }

      try {
        await this.orphanedIntentsReconciliation.reconcile();
      } catch (error) {
        console.error('Error in reconcileOrphanedIntents:', error);
      }

      console.log('Reconciliation cycle complete');
    } catch (error) {
      console.error('Unexpected error in reconciliation cycle:', error);
    } finally {
      this.isReconciling = false;
    }
  }

  /**
   * Execute MinIO cleanup cycle
   * Removes orphaned objects from MinIO storage
   */
  private async runMinioCleanupCycle(): Promise<void> {
    try {
      console.log('Starting MinIO orphaned object cleanup...');
      await this.orphanedMinioReconciliation.reconcile();
      console.log('MinIO cleanup complete');
    } catch (error) {
      console.error('Error in MinIO cleanup cycle:', error);
    }
  }
}

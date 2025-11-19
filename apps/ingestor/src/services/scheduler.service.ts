import { inject, singleton } from "tsyringe";
import type { Config } from "../config.js";
import { StuckUploadsReconciliation } from "./reconciliation/stuck-uploads-reconciliation.service.js";
import { MissingEventsReconciliation } from "./reconciliation/missing-events-reconciliation.service.js";
import { OrphanedIntentsReconciliation } from "./reconciliation/orphaned-intents-reconciliation.service.js";
import { OrphanedMinioReconciliation } from "./reconciliation/orphaned-minio-reconciliation.service.js";

/**
 * Scheduler service for running background reconciliation tasks.
 *
 * Manages two intervals:
 * - Reconciliation cycle: Runs stuck uploads, missing events, and orphaned intents reconciliation
 * - MinIO cleanup cycle: Removes orphaned objects from MinIO storage
 */
@singleton()
export class SchedulerService {
  private reconciliationInterval: NodeJS.Timeout | null = null;
  private minioCleanupInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isReconciling = false;

  constructor(
    @inject("config") private readonly config: Config,
    @inject(StuckUploadsReconciliation) private readonly stuckUploadsReconciliation: StuckUploadsReconciliation,
    @inject(MissingEventsReconciliation) private readonly missingEventsReconciliation: MissingEventsReconciliation,
    @inject(OrphanedIntentsReconciliation) private readonly orphanedIntentsReconciliation: OrphanedIntentsReconciliation,
    @inject(OrphanedMinioReconciliation) private readonly orphanedMinioReconciliation: OrphanedMinioReconciliation
  ) {}

  /**
   * Start the reconciliation scheduler
   * Runs reconciliation every 5 minutes (or 100ms in test mode)
   * Runs MinIO cleanup every 24 hours (or 500ms in test mode)
   */
  start(): void {
    if (this.isRunning) {
      console.log("Scheduler already running, ignoring start request");
      return;
    }

    console.log("Starting reconciliation scheduler...");

    // Run reconciliation on regular interval
    this.reconciliationInterval = setInterval(() => {
      this.runReconciliationCycle().catch((error) => {
        console.error("Fatal error in reconciliation interval:", error);
      });
    }, this.config.reconciliationIntervalMs);

    // Run MinIO cleanup on separate interval
    this.minioCleanupInterval = setInterval(() => {
      this.runMinioCleanupCycle().catch((error) => {
        console.error("Fatal error in MinIO cleanup interval:", error);
      });
    }, this.config.minioCleanupIntervalMs);

    this.isRunning = true;
    console.log(
      `Scheduler started (reconciliation: ${this.config.reconciliationIntervalMs}ms, MinIO cleanup: ${this.config.minioCleanupIntervalMs}ms)`,
    );
  }

  /**
   * Stop the reconciliation scheduler
   * Called during graceful shutdown
   */
  stop(): void {
    if (!this.isRunning) {
      console.log("Scheduler not running, nothing to stop");
      return;
    }

    console.log("Stopping reconciliation scheduler...");

    if (this.reconciliationInterval) {
      clearInterval(this.reconciliationInterval);
      this.reconciliationInterval = null;
    }

    if (this.minioCleanupInterval) {
      clearInterval(this.minioCleanupInterval);
      this.minioCleanupInterval = null;
    }

    this.isRunning = false;
    console.log("Scheduler stopped");
  }

  /**
   * Stop the scheduler and wait for current cycle to complete
   * Use this in tests or during graceful shutdown
   */
  async stopAndWait(): Promise<void> {
    this.stop();

    // Wait for any in-progress reconciliation to complete
    while (this.isReconciling) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Run reconciliation immediately (for testing or admin trigger)
   * This can be called independently of the scheduler
   */
  async runReconciliationNow(): Promise<void> {
    console.log("Running manual reconciliation...");
    await this.runReconciliationCycle();
    console.log("Manual reconciliation complete");
  }

  /**
   * Execute a single reconciliation cycle
   * Runs all reconciliation functions sequentially
   */
  private async runReconciliationCycle(): Promise<void> {
    // Prevent concurrent reconciliation cycles
    if (this.isReconciling) {
      console.log("Reconciliation cycle already in progress, skipping...");
      return;
    }

    this.isReconciling = true;

    try {
      console.log("Starting reconciliation cycle...");

      // Run all reconciliation functions sequentially
      // Each function handles its own errors internally, but we catch any unexpected ones

      try {
        await this.stuckUploadsReconciliation.reconcile();
      } catch (error) {
        console.error("Error in reconcileStuckUploads:", error);
      }

      try {
        await this.missingEventsReconciliation.reconcile();
      } catch (error) {
        console.error("Error in reconcileMissingEvents:", error);
      }

      try {
        await this.orphanedIntentsReconciliation.reconcile();
      } catch (error) {
        console.error("Error in reconcileOrphanedIntents:", error);
      }

      console.log("Reconciliation cycle complete");
    } catch (error) {
      console.error("Unexpected error in reconciliation cycle:", error);
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
      console.log("Starting MinIO orphaned object cleanup...");
      await this.orphanedMinioReconciliation.reconcile();
      console.log("MinIO cleanup complete");
    } catch (error) {
      console.error("Error in MinIO cleanup cycle:", error);
    }
  }
}

import { and, eq, lt } from "drizzle-orm";
import { inject, injectable, singleton } from "tsyringe";
import type { Config } from "../../config.js";
import { DatabaseConnection } from "../../connections/database.js";
import { ReconciliationConstants } from "../../constants/reconciliation.constants.js";
import { wallpapers } from "../../db/schema.js";
import { StorageService } from "../storage.service.js";
import {
    BaseReconciliation,
    type TransactionType,
} from "./base-reconciliation.service.js";

type WallpaperRecord = typeof wallpapers.$inferSelect;

/**
 * Reconciles uploads stuck in 'uploading' state for longer than threshold.
 *
 * Recovery logic:
 * - If file exists in MinIO: recover to 'stored' state
 * - If file missing and retries < MAX: increment retry count
 * - If file missing and retries >= MAX: mark as 'failed'
 */
@singleton()
export class StuckUploadsReconciliation extends BaseReconciliation<WallpaperRecord> {
    constructor(
        @inject(StorageService) private readonly storageService: StorageService,
        @inject(DatabaseConnection) databaseConnection: DatabaseConnection,
        @inject("config") private readonly config: Config
    ) {
        super(databaseConnection.getClient().db);
    }

    protected getOperationName(): string {
        return "Stuck Uploads Reconciliation";
    }

    protected async getRecordsToProcess(
        tx: TransactionType,
    ): Promise<WallpaperRecord[]> {
        const thresholdDate = new Date(
            Date.now() - ReconciliationConstants.STUCK_UPLOAD_THRESHOLD_MS,
        );

        const records = await tx
            .select()
            .from(wallpapers)
            .where(
                and(
                    eq(wallpapers.uploadState, "uploading"),
                    lt(wallpapers.stateChangedAt, thresholdDate),
                ),
            )
            .limit(1)
            .for("update", { skipLocked: true }); // CRITICAL for multi-instance safety

        return records;
    }

    protected async processRecord(
        record: WallpaperRecord,
        tx: TransactionType,
    ): Promise<void> {
        // Construct storage key (format: {wallpaperId}/original.{ext})
        // For reconciliation, we try with .jpg as default since extension may not be stored yet
        const storageKey = `${record.id}/original.jpg`;

        // Check if file exists in MinIO
        const fileExists = await this.storageService.objectExists(
            this.config.s3Bucket,
            storageKey,
        );

        if (fileExists) {
            // File exists - recover to 'stored' state
            await tx
                .update(wallpapers)
                .set({
                    uploadState: "stored",
                    stateChangedAt: new Date(),
                })
                .where(eq(wallpapers.id, record.id));

            console.log(`Recovered stuck upload ${record.id} to 'stored' state`);
        } else {
            // File missing - check retry attempts
            if (record.uploadAttempts >= ReconciliationConstants.MAX_UPLOAD_RETRIES) {
                // Max retries exceeded - mark as failed
                await tx
                    .update(wallpapers)
                    .set({
                        uploadState: "failed",
                        processingError: "Max retries exceeded",
                        stateChangedAt: new Date(),
                    })
                    .where(eq(wallpapers.id, record.id));

                console.log(
                    `Marked upload ${record.id} as failed (max retries exceeded)`,
                );
            } else {
                // Increment retry attempts
                await tx
                    .update(wallpapers)
                    .set({
                        uploadAttempts: record.uploadAttempts + 1,
                        stateChangedAt: new Date(),
                    })
                    .where(eq(wallpapers.id, record.id));

                console.log(
                    `Incremented retry attempts for upload ${record.id} (${record.uploadAttempts + 1}/${ReconciliationConstants.MAX_UPLOAD_RETRIES})`,
                );
            }
        }
    }
}

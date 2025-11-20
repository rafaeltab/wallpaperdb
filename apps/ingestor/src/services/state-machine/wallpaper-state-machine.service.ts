import { eq } from 'drizzle-orm';
import { inject, injectable } from 'tsyringe';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../db/schema.js';
import { wallpapers } from '../../db/schema.js';
import type { TimeService } from '../core/time.service.js';
import { DatabaseConnection } from '../../connections/database.js';

type DbType = NodePgDatabase<typeof schema>;
type UploadState = 'initiated' | 'uploading' | 'stored' | 'processing' | 'completed' | 'failed';
type WallpaperUpdate = Partial<typeof wallpapers.$inferInsert>;

/**
 * State machine service for wallpaper upload states.
 * Enforces valid state transitions and provides a centralized place for state management.
 *
 * Valid state transitions:
 * - initiated → uploading | failed
 * - uploading → stored | failed
 * - stored → processing | failed
 * - processing → completed | failed
 * - completed → (terminal state)
 * - failed → (terminal state)
 */
@injectable()
export class WallpaperStateMachine {
  private readonly validTransitions: Record<UploadState, UploadState[]> = {
    initiated: ['uploading', 'failed'],
    uploading: ['stored', 'failed'],
    stored: ['processing', 'failed'],
    processing: ['completed', 'failed'],
    completed: [], // Terminal state
    failed: [], // Terminal state
  };

  private readonly db: DbType;

  constructor(
    @inject(DatabaseConnection) databaseConnection: DatabaseConnection,
    @inject('TimeService') private readonly timeService: TimeService
  ) {
    this.db = databaseConnection.getClient().db;
  }

  /**
   * Transition a wallpaper to a new state with optional metadata updates.
   *
   * @param wallpaperId - The wallpaper ID
   * @param newState - The target state
   * @param metadata - Optional additional fields to update
   * @throws {Error} If the transition is invalid
   */
  async transitionTo(
    wallpaperId: string,
    newState: UploadState,
    metadata?: WallpaperUpdate
  ): Promise<void> {
    // Get current state for validation
    const current = await this.db.query.wallpapers.findFirst({
      where: eq(wallpapers.id, wallpaperId),
      columns: { uploadState: true },
    });

    if (!current) {
      throw new Error(`Wallpaper ${wallpaperId} not found`);
    }

    // Validate transition
    const currentState = current.uploadState as UploadState;
    if (!this.canTransition(currentState, newState)) {
      throw new Error(
        `Invalid state transition from '${currentState}' to '${newState}' for wallpaper ${wallpaperId}`
      );
    }

    // Perform the update
    await this.db
      .update(wallpapers)
      .set({
        uploadState: newState,
        stateChangedAt: this.timeService.now(),
        ...metadata,
      })
      .where(eq(wallpapers.id, wallpaperId));
  }

  /**
   * Transition to 'uploading' state.
   */
  async transitionToUploading(wallpaperId: string): Promise<void> {
    await this.transitionTo(wallpaperId, 'uploading');
  }

  /**
   * Transition to 'stored' state with full metadata.
   */
  async transitionToStored(
    wallpaperId: string,
    metadata: {
      fileType: 'image' | 'video';
      mimeType: string;
      fileSizeBytes: number;
      width: number;
      height: number;
      aspectRatio: string;
      storageKey: string;
      storageBucket: string;
      originalFilename: string;
    }
  ): Promise<void> {
    await this.transitionTo(wallpaperId, 'stored', metadata);
  }

  /**
   * Transition to 'processing' state (after NATS event published).
   */
  async transitionToProcessing(wallpaperId: string): Promise<void> {
    await this.transitionTo(wallpaperId, 'processing');
  }

  /**
   * Transition to 'completed' state.
   */
  async transitionToCompleted(wallpaperId: string): Promise<void> {
    await this.transitionTo(wallpaperId, 'completed');
  }

  /**
   * Transition to 'failed' state with error message.
   */
  async transitionToFailed(wallpaperId: string, errorMessage: string): Promise<void> {
    await this.transitionTo(wallpaperId, 'failed', {
      processingError: errorMessage,
    });
  }

  /**
   * Check if a state transition is valid.
   *
   * @param currentState - The current state
   * @param newState - The target state
   * @returns true if the transition is valid, false otherwise
   */
  canTransition(currentState: UploadState, newState: UploadState): boolean {
    const allowedTransitions = this.validTransitions[currentState];
    return allowedTransitions.includes(newState);
  }

  /**
   * Get the current state of a wallpaper.
   *
   * @param wallpaperId - The wallpaper ID
   * @returns The current upload state or null if not found
   */
  async getCurrentState(wallpaperId: string): Promise<UploadState | null> {
    const result = await this.db.query.wallpapers.findFirst({
      where: eq(wallpapers.id, wallpaperId),
      columns: { uploadState: true },
    });

    return result ? (result.uploadState as UploadState) : null;
  }
}

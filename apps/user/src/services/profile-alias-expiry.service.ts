import { SystemTimerService, type TimerService } from '@wallpaperdb/core/timer';
import { and, eq, gt, lte, or } from 'drizzle-orm';
import type { DatabaseConnection } from '../connections/database.js';
import { handleClaims } from '../db/schema.js';
import type { AliasClaimReference } from './profile.service.js';

const EXPIRY_INTERVAL_MS = 1_000;
const EXPIRY_BATCH_SIZE = 100;

interface ExpiryLogger {
  error(bindings: object, message: string): void;
}

export class ProfileAliasExpiryWorker {
  private interval: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private stopping = false;

  constructor(
    private readonly database: DatabaseConnection,
    private readonly expireAlias: (reference: AliasClaimReference, now: Date) => Promise<boolean>,
    private readonly logger: ExpiryLogger,
    private readonly timer: TimerService = new SystemTimerService()
  ) {}

  start(): void {
    if (this.interval) return;
    this.stopping = false;
    const run = () => this.expirePending().catch((error) => {
      this.logger.error({ err: error }, 'Profile alias expiry cycle failed');
    });
    void run();
    this.interval = this.timer.setInterval(run, EXPIRY_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.interval) this.timer.clearInterval(this.interval);
    this.interval = null;
    await this.inFlight;
  }

  expirePending(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.expireBatches().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async expireBatches(): Promise<void> {
    const now = new Date();
    let cursor: { expiresAt: Date; handle: string } | undefined;
    while (!this.stopping) {
      const aliases = await this.database.getClient().db.query.handleClaims.findMany({
        where: and(
          eq(handleClaims.kind, 'alias'),
          lte(handleClaims.expiresAt, now),
          cursor ? or(
            gt(handleClaims.expiresAt, cursor.expiresAt),
            and(eq(handleClaims.expiresAt, cursor.expiresAt), gt(handleClaims.handle, cursor.handle))
          ) : undefined
        ),
        columns: { handle: true, profileId: true, claimGeneration: true, expiresAt: true },
        orderBy: [handleClaims.expiresAt, handleClaims.handle],
        limit: EXPIRY_BATCH_SIZE,
      });
      for (const alias of aliases) {
        if (this.stopping) break;
        try {
          await this.expireAlias(alias, now);
        } catch (error) {
          this.logger.error({ err: error, handle: alias.handle, profileId: alias.profileId }, 'Profile alias expiry failed; will retry');
        }
      }
      const last = aliases.at(-1);
      if (aliases.length < EXPIRY_BATCH_SIZE || !last?.expiresAt) break;
      // Advance past failures so a bad event cannot block later due claims.
      cursor = { expiresAt: last.expiresAt, handle: last.handle };
    }
  }
}

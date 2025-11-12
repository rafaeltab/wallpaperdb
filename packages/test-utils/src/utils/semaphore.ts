/**
 * Simple semaphore implementation for limiting concurrent operations.
 * Used to prevent Docker daemon overload during parallel test execution.
 */
export class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  /**
   * Acquire a permit. If none available, waits until one is released.
   */
  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  /**
   * Release a permit, allowing the next waiting operation to proceed.
   */
  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }

  /**
   * Execute a function with semaphore protection.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

/**
 * Global semaphore for Docker container operations.
 * Limits concurrent container starts to prevent daemon overload.
 *
 * With 32 CPU cores and 80GB RAM, we can safely start ~32 containers concurrently.
 * MinIO containers are lightweight and start quickly.
 */
export const dockerStartSemaphore = new Semaphore(32);

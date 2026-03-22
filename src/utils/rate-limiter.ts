/**
 * Token-bucket rate limiter.
 *
 * The bucket starts full and refills at a steady rate. Each `acquire()` call
 * consumes one token. If no tokens are available the call awaits until a
 * token becomes available.
 */

export class RateLimiter {
  private tokens: number;
  private readonly maxBurst: number;
  private readonly tokensPerSecond: number;
  private lastRefillTime: number;

  /**
   * Pending waiters, ordered FIFO.  Each entry holds the `resolve` function
   * of a promise that will be settled once a token is available.
   */
  private readonly queue: Array<() => void> = [];

  /**
   * @param tokensPerSecond  Steady-state refill rate.
   * @param maxBurst         Maximum tokens the bucket can hold (burst capacity).
   */
  constructor(tokensPerSecond: number, maxBurst: number) {
    if (tokensPerSecond <= 0) {
      throw new RangeError("tokensPerSecond must be positive");
    }
    if (maxBurst < 1) {
      throw new RangeError("maxBurst must be at least 1");
    }

    this.tokensPerSecond = tokensPerSecond;
    this.maxBurst = maxBurst;
    this.tokens = maxBurst; // start full
    this.lastRefillTime = Date.now();
  }

  /**
   * Acquire a single token.
   *
   * Resolves immediately if a token is available; otherwise the returned
   * promise resolves once a token has been replenished.
   */
  async acquire(): Promise<void> {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    // No tokens available – enqueue and wait.
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
      this.scheduleRelease();
    });
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Add tokens accrued since the last refill. */
  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefillTime) / 1_000; // seconds
    const newTokens = elapsed * this.tokensPerSecond;

    this.tokens = Math.min(this.maxBurst, this.tokens + newTokens);
    this.lastRefillTime = now;
  }

  /**
   * Schedule a `setTimeout` that fires once enough time has passed for a
   * single token to become available, then drains the wait queue.
   */
  private scheduleRelease(): void {
    // Only schedule if exactly one waiter triggered this; additional waiters
    // will be drained by the same timeout cascade.
    if (this.queue.length !== 1) {
      return;
    }

    const drainNext = (): void => {
      this.refill();

      if (this.queue.length === 0) {
        return;
      }

      if (this.tokens >= 1) {
        this.tokens -= 1;
        const next = this.queue.shift();
        next?.();

        // If more waiters remain, continue draining.
        if (this.queue.length > 0) {
          const delayMs = (1 / this.tokensPerSecond) * 1_000;
          setTimeout(drainNext, delayMs);
        }
      } else {
        // Should not happen after a well-calculated delay, but be safe.
        const delayMs = (1 / this.tokensPerSecond) * 1_000;
        setTimeout(drainNext, delayMs);
      }
    };

    const delayMs = (1 / this.tokensPerSecond) * 1_000;
    setTimeout(drainNext, delayMs);
  }
}

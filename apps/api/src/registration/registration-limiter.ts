export interface RegistrationLimiterOptions {
  windowMs?: number;
  perAddressLimit?: number;
  globalLimit?: number;
  maxAddresses?: number;
}

interface AttemptWindow {
  expiresAt: number;
  attempts: number;
}

/**
 * Bounded, process-local registration attempt budgets. Every admitted attempt
 * counts, including requests that later fail validation or registration.
 *
 * Fixed windows permit a burst on either side of a window boundary. A process
 * restart clears these budgets, and multiple API instances would have separate
 * budgets. The caller must use the actual client connection address rather than
 * trusting a client-supplied forwarding header.
 */
export class RegistrationLimiter {
  private readonly windowMs: number;
  private readonly perAddressLimit: number;
  private readonly globalLimit: number;
  private readonly maxAddresses: number;
  private readonly addresses = new Map<string, AttemptWindow>();
  private globalWindow: AttemptWindow | undefined;

  constructor(options: RegistrationLimiterOptions = {}) {
    this.windowMs = options.windowMs ?? 15 * 60 * 1000;
    this.perAddressLimit = options.perAddressLimit ?? 10;
    this.globalLimit = options.globalLimit ?? 100;
    this.maxAddresses = options.maxAddresses ?? 4096;

    for (const [name, value] of Object.entries({
      windowMs: this.windowMs,
      perAddressLimit: this.perAddressLimit,
      globalLimit: this.globalLimit,
      maxAddresses: this.maxAddresses,
    })) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`Registration limiter ${name} must be a positive safe integer.`);
      }
    }
  }

  /** Returns whole Retry-After seconds on denial, or undefined on admission. */
  consume(address: string, now = Date.now()): number | undefined {
    for (const [key, window] of this.addresses) {
      if (window.expiresAt <= now) this.addresses.delete(key);
    }
    if (this.globalWindow && this.globalWindow.expiresAt <= now) {
      this.globalWindow = undefined;
    }

    const addressWindow = this.addresses.get(address);
    let retryAt: number | undefined;
    if (addressWindow && addressWindow.attempts >= this.perAddressLimit) {
      retryAt = addressWindow.expiresAt;
    }
    if (this.globalWindow && this.globalWindow.attempts >= this.globalLimit) {
      retryAt = Math.max(retryAt ?? now, this.globalWindow.expiresAt);
    }
    if (!addressWindow && this.addresses.size >= this.maxAddresses) {
      // Never evict a live address: doing so would restore that address's budget.
      const earliestExpiry = Math.min(...Array.from(this.addresses.values(), (window) => window.expiresAt));
      retryAt = Math.max(retryAt ?? now, earliestExpiry);
    }
    if (retryAt !== undefined) {
      return Math.max(1, Math.ceil((retryAt - now) / 1000));
    }

    if (addressWindow) {
      addressWindow.attempts += 1;
    } else {
      this.addresses.set(address, { expiresAt: now + this.windowMs, attempts: 1 });
    }
    if (this.globalWindow) {
      this.globalWindow.attempts += 1;
    } else {
      // Denied requests cannot start or extend either kind of window.
      this.globalWindow = { expiresAt: now + this.windowMs, attempts: 1 };
    }
    return undefined;
  }
}

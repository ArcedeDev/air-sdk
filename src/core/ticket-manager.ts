/**
 * TicketManager — Client-side Session Ticket rotation for the AIR SDK.
 *
 * Manages an array of prepaid Session Tickets and handles automatic rotation
 * when a ticket depletes. Treats tickets as immutable "gift cards" — when one
 * runs out, the manager silently swaps to the next one in the pool.
 *
 * Usage:
 *   const tickets = new TicketManager(['eyJhbG...ticket1', 'eyJhbG...ticket2']);
 *   const header = tickets.getAuthHeader();  // "Ticket eyJhbG...ticket1"
 *   // On 402 ticket_depleted response:
 *   tickets.markDepleted();                  // rotates to ticket2
 */

export interface TicketInfo {
  /** The raw JWT string */
  jwt: string;
  /** Whether this ticket has been marked as depleted */
  depleted: boolean;
  /** Optional: the intent this ticket was purchased for */
  intent?: string;
  /** Optional: when the ticket expires (decoded from JWT for local pre-flight checks) */
  expiresAt?: Date;
}

export interface TicketManagerOptions {
  /**
   * Called when the last ticket in the pool is depleted.
   * Use this to trigger auto-purchase of a new ticket batch.
   * If this returns a JWT string, it will be added to the pool.
   */
  onExhausted?: () => Promise<string | string[] | void>;

  /**
   * Called whenever a ticket rotation occurs. Useful for logging/telemetry.
   */
  onRotation?: (depleted: TicketInfo, next: TicketInfo | null) => void;

  /**
   * Called when an error occurs during onExhausted or internal operations.
   * Without this, errors are silently swallowed.
   */
  onError?: (error: unknown) => void;

  /**
   * If true, automatically remove expired tickets from the pool on access.
   * Default: true.
   */
  autoEvictExpired?: boolean;
}

export class TicketManager {
  private tickets: TicketInfo[] = [];
  private activeIndex: number = 0;
  private options: TicketManagerOptions;
  private _rotationPromise: Promise<TicketInfo | null> | null = null;

  constructor(initialTickets: string | string[], options?: TicketManagerOptions) {
    this.options = {
      autoEvictExpired: true,
      ...options,
    };

    const jwts = Array.isArray(initialTickets) ? initialTickets : [initialTickets];
    for (const jwt of jwts) {
      if (jwt && jwt.trim().length > 0) {
        this.tickets.push(this.parseTicket(jwt.trim()));
      }
    }
  }

  /**
   * Get the Authorization header value for the current active ticket.
   * Returns "Ticket <jwt>" or null if no valid tickets remain.
   */
  getAuthHeader(): string | null {
    const ticket = this.getActiveTicket();
    if (!ticket) return null;
    return `Ticket ${ticket.jwt}`;
  }

  /**
   * Get the current active ticket, skipping depleted and expired tickets.
   * Returns null if no valid tickets remain.
   */
  getActiveTicket(): TicketInfo | null {
    if (this.tickets.length === 0) return null;

    // Evict expired tickets if enabled
    if (this.options.autoEvictExpired) {
      this.evictExpired();
    }

    // Find the next non-depleted, non-expired ticket starting from activeIndex
    const now = new Date();
    for (let i = 0; i < this.tickets.length; i++) {
      const idx = (this.activeIndex + i) % this.tickets.length;
      const ticket = this.tickets[idx];
      if (!ticket.depleted && (!ticket.expiresAt || ticket.expiresAt > now)) {
        this.activeIndex = idx;
        return ticket;
      }
    }

    return null; // All tickets depleted or expired
  }

  /**
   * Mark the current active ticket as depleted and rotate to the next one.
   * Call this when you receive a 402 ticket_depleted response from the API.
   *
   * Returns the next active ticket, or null if all tickets are depleted.
   * If an onExhausted callback is defined and returns new JWT(s), those are
   * added to the pool before returning null.
   */
  async markDepleted(): Promise<TicketInfo | null> {
    // Guard against concurrent calls (e.g. multiple 402 responses arriving in parallel)
    // If a rotation is already in progress, await it so all callers get the new ticket once it arrives
    if (this._rotationPromise) {
      return this._rotationPromise;
    }

    this._rotationPromise = this._markDepletedInner().finally(() => {
      this._rotationPromise = null;
    });

    return this._rotationPromise;
  }

  private async _markDepletedInner(): Promise<TicketInfo | null> {
    const current = this.tickets[this.activeIndex];
    if (current) {
      current.depleted = true;
    }

    // Try to find the next valid ticket
    const next = this.findNextActive();

    if (next) {
      this.options.onRotation?.(current, next);
      return next;
    }

    // All tickets depleted — try the onExhausted callback
    if (this.options.onExhausted) {
      try {
        const result = await this.options.onExhausted();
        if (result) {
          const newJwts = Array.isArray(result) ? result : [result];
          for (const jwt of newJwts) {
            this.addTicket(jwt);
          }
          const refreshed = this.findNextActive();
          this.options.onRotation?.(current, refreshed);
          return refreshed;
        }
      } catch (err) {
        this.options.onError?.(err);
      }
    }

    this.options.onRotation?.(current, null);
    return null;
  } // end _markDepletedInner

  /**
   * Add a new ticket to the pool. Can be called at any time to top up.
   * Rejects duplicates — the same JWT cannot be added twice.
   */
  addTicket(jwt: string): void {
    const trimmed = jwt?.trim();
    if (!trimmed) return;
    // Prevent duplicate JWTs in the pool
    if (this.tickets.some(t => t.jwt === trimmed)) return;
    this.tickets.push(this.parseTicket(trimmed));
  }

  /**
   * Returns the number of non-depleted, non-expired tickets remaining.
   */
  get remaining(): number {
    const now = new Date();
    return this.tickets.filter(t => !t.depleted && (!t.expiresAt || t.expiresAt > now)).length;
  }

  /**
   * Returns true if there are no valid tickets left.
   */
  get isEmpty(): boolean {
    return this.remaining === 0;
  }

  /**
   * Returns total tickets in the pool (including depleted/expired).
   */
  get poolSize(): number {
    return this.tickets.length;
  }

  // ── Internal helpers ──

  private findNextActive(): TicketInfo | null {
    for (let i = 0; i < this.tickets.length; i++) {
      const idx = (this.activeIndex + 1 + i) % this.tickets.length;
      const ticket = this.tickets[idx];
      if (!ticket.depleted && (!ticket.expiresAt || ticket.expiresAt > new Date())) {
        this.activeIndex = idx;
        return ticket;
      }
    }
    return null;
  }

  private evictExpired(): void {
    const now = new Date();
    // Track the current active ticket's JWT to re-find it after filtering
    const activeJwt = this.tickets[this.activeIndex]?.jwt;
    const before = this.tickets.length;
    // Evict tickets that are explicitly depleted OR have passed their expiration date
    this.tickets = this.tickets.filter(t => !t.depleted && (!t.expiresAt || t.expiresAt > now));

    if (this.tickets.length !== before) {
      // Re-find the active ticket by JWT, or reset to 0
      const newIdx = activeJwt ? this.tickets.findIndex(t => t.jwt === activeJwt) : -1;
      this.activeIndex = newIdx >= 0 ? newIdx : 0;
    }
  }

  private parseTicket(jwt: string): TicketInfo {
    const info: TicketInfo = { jwt, depleted: false };

    // Attempt to decode the JWT payload (base64url) to extract exp and intent
    try {
      const parts = jwt.split('.');
      if (parts.length === 3) {
        const payloadB64 = parts[1]
          .replace(/-/g, '+')
          .replace(/_/g, '/');
        const padding = '='.repeat((4 - payloadB64.length % 4) % 4);
        // Use atob (browser) or Buffer (Node.js) for decoding
        const b64String = payloadB64 + padding;
        const jsonString = typeof atob === 'function'
          ? atob(b64String)
          : Buffer.from(b64String, 'base64').toString('utf-8');
        const decoded = JSON.parse(jsonString);

        if (decoded.exp) {
          info.expiresAt = new Date(decoded.exp * 1000);
        }
        if (decoded.intent) {
          info.intent = decoded.intent;
        }
      }
    } catch {
      // JWT decoding failed — still usable, server will validate
    }

    return info;
  }
}

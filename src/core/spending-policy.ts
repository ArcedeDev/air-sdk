// ============================================================
// AIR SDK — Spending Policy Manager
// Stateful budget tracker with per-request, per-session, and
// per-domain spending limits for MPP payments.
// ============================================================

import type { MPPConfig, SpendingPolicy, SpendingLedger } from './types';

export class SpendingPolicyManager {
  private policy: SpendingPolicy;
  private ledger: SpendingLedger;

  constructor(config: MPPConfig) {
    this.policy = {
      maxPerRequest: config.maxPerRequest,
      maxPerSession: config.maxPerSession,
      // When autoApprove is true, auto-approve anything within the per-request limit.
      // When false, require explicit approval for all amounts.
      autoApproveBelow: config.autoApprove ? config.maxPerRequest : 0,
      requireApprovalDomains: [],
    };

    this.ledger = {
      sessionTotal: 0,
      requestCount: 0,
      domainTotals: {},
    };
  }

  /**
   * Record a completed payment in the session ledger.
   */
  recordPayment(domain: string, amount: number): void {
    // Round to 2 decimal places to avoid floating-point drift
    this.ledger.sessionTotal = round2(this.ledger.sessionTotal + amount);
    this.ledger.requestCount += 1;
    this.ledger.domainTotals[domain] = round2(
      (this.ledger.domainTotals[domain] ?? 0) + amount
    );
  }

  /**
   * Check whether a proposed payment is within all policy limits.
   * Returns `allowed: true` or an explanatory rejection reason.
   */
  isWithinLimits(
    amount: number,
    domain: string
  ): { allowed: boolean; reason?: string } {
    // 1. Per-request limit
    if (round2(amount) > this.policy.maxPerRequest) {
      return { allowed: false, reason: 'exceeds_per_request' };
    }

    // 2. Session limit
    if (round2(this.ledger.sessionTotal + amount) > this.policy.maxPerSession) {
      return { allowed: false, reason: 'exceeds_session' };
    }

    // 3. Domain requires manual approval
    if (this.policy.requireApprovalDomains.includes(domain)) {
      return { allowed: false, reason: 'domain_requires_approval' };
    }

    return { allowed: true };
  }

  /**
   * Whether the amount qualifies for automatic approval (no callback needed).
   */
  isAutoApprovable(amount: number): boolean {
    return round2(amount) <= this.policy.autoApproveBelow;
  }

  /**
   * Remaining session budget in USD.
   */
  get remainingBudget(): number {
    return round2(this.policy.maxPerSession - this.ledger.sessionTotal);
  }

  /**
   * Total spent on a specific domain this session.
   */
  getDomainSpending(domain: string): number {
    return this.ledger.domainTotals[domain] ?? 0;
  }

  /**
   * Reset the session ledger (e.g., on new browsing session).
   */
  reset(): void {
    this.ledger = {
      sessionTotal: 0,
      requestCount: 0,
      domainTotals: {},
    };
  }

  /**
   * Serialize the current ledger for telemetry or inspection.
   */
  toLedger(): SpendingLedger {
    return { ...this.ledger, domainTotals: { ...this.ledger.domainTotals } };
  }

  /**
   * Add a domain to the "always require manual approval" list.
   */
  addApprovalDomain(domain: string): void {
    if (!this.policy.requireApprovalDomains.includes(domain)) {
      this.policy.requireApprovalDomains.push(domain);
    }
  }
}

// ---- Helpers ----

/** Round to 2 decimal places to prevent floating-point accumulation errors. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

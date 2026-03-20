import { describe, it, expect } from 'vitest';
import { SpendingPolicyManager } from '../../src/core/spending-policy';
import type { MPPConfig } from '../../src/core/types';

function makeConfig(overrides: Partial<MPPConfig> = {}): MPPConfig {
  return {
    enabled: true,
    paymentMethod: 'stripe_spt',
    credential: 'spt_test_123',
    maxPerRequest: 1.00,
    maxPerSession: 5.00,
    autoApprove: true,
    ...overrides,
  };
}

describe('SpendingPolicyManager', () => {
  describe('initial state', () => {
    it('starts with zero spending and full budget', () => {
      const pm = new SpendingPolicyManager(makeConfig());
      const ledger = pm.toLedger();
      expect(ledger.sessionTotal).toBe(0);
      expect(ledger.requestCount).toBe(0);
      expect(ledger.domainTotals).toEqual({});
      expect(pm.remainingBudget).toBe(5.00);
    });
  });

  describe('recordPayment', () => {
    it('updates session total and request count', () => {
      const pm = new SpendingPolicyManager(makeConfig());
      pm.recordPayment('example.com', 0.50);
      const ledger = pm.toLedger();
      expect(ledger.sessionTotal).toBe(0.50);
      expect(ledger.requestCount).toBe(1);
    });

    it('tracks per-domain spending', () => {
      const pm = new SpendingPolicyManager(makeConfig());
      pm.recordPayment('a.com', 0.10);
      pm.recordPayment('b.com', 0.20);
      pm.recordPayment('a.com', 0.30);
      expect(pm.getDomainSpending('a.com')).toBe(0.40);
      expect(pm.getDomainSpending('b.com')).toBe(0.20);
      expect(pm.getDomainSpending('c.com')).toBe(0);
    });

    it('handles floating-point accumulation correctly', () => {
      const pm = new SpendingPolicyManager(makeConfig());
      // 0.1 + 0.2 = 0.30000000000000004 in JS without rounding
      pm.recordPayment('test.com', 0.1);
      pm.recordPayment('test.com', 0.2);
      expect(pm.toLedger().sessionTotal).toBe(0.30);
      expect(pm.getDomainSpending('test.com')).toBe(0.30);
    });
  });

  describe('isWithinLimits', () => {
    it('allows payments within all limits', () => {
      const pm = new SpendingPolicyManager(makeConfig());
      expect(pm.isWithinLimits(0.50, 'example.com')).toEqual({ allowed: true });
    });

    it('rejects payments exceeding per-request limit', () => {
      const pm = new SpendingPolicyManager(makeConfig({ maxPerRequest: 0.10 }));
      expect(pm.isWithinLimits(0.50, 'example.com')).toEqual({
        allowed: false,
        reason: 'exceeds_per_request',
      });
    });

    it('rejects payments that would exceed session limit', () => {
      const pm = new SpendingPolicyManager(makeConfig({ maxPerSession: 1.00 }));
      pm.recordPayment('example.com', 0.90);
      expect(pm.isWithinLimits(0.20, 'example.com')).toEqual({
        allowed: false,
        reason: 'exceeds_session',
      });
    });

    it('rejects payments for domains requiring approval', () => {
      const pm = new SpendingPolicyManager(makeConfig());
      pm.addApprovalDomain('premium.com');
      expect(pm.isWithinLimits(0.01, 'premium.com')).toEqual({
        allowed: false,
        reason: 'domain_requires_approval',
      });
    });
  });

  describe('isAutoApprovable', () => {
    it('auto-approves when autoApprove is true and within maxPerRequest', () => {
      const pm = new SpendingPolicyManager(makeConfig({ autoApprove: true, maxPerRequest: 1.00 }));
      expect(pm.isAutoApprovable(0.50)).toBe(true);
      expect(pm.isAutoApprovable(1.00)).toBe(true);
    });

    it('never auto-approves when autoApprove is false', () => {
      const pm = new SpendingPolicyManager(makeConfig({ autoApprove: false }));
      expect(pm.isAutoApprovable(0.01)).toBe(false);
    });
  });

  describe('remainingBudget', () => {
    it('decreases correctly after payments', () => {
      const pm = new SpendingPolicyManager(makeConfig({ maxPerSession: 10.00 }));
      pm.recordPayment('a.com', 3.50);
      expect(pm.remainingBudget).toBe(6.50);
      pm.recordPayment('b.com', 2.50);
      expect(pm.remainingBudget).toBe(4.00);
    });
  });

  describe('reset', () => {
    it('clears all spending data', () => {
      const pm = new SpendingPolicyManager(makeConfig());
      pm.recordPayment('a.com', 1.00);
      pm.recordPayment('b.com', 2.00);
      pm.reset();
      expect(pm.toLedger().sessionTotal).toBe(0);
      expect(pm.toLedger().requestCount).toBe(0);
      expect(pm.toLedger().domainTotals).toEqual({});
      expect(pm.remainingBudget).toBe(5.00);
    });
  });

  describe('toLedger', () => {
    it('returns a detached copy (mutations do not propagate)', () => {
      const pm = new SpendingPolicyManager(makeConfig());
      pm.recordPayment('test.com', 1.00);
      const ledger = pm.toLedger();
      ledger.sessionTotal = 999;
      ledger.domainTotals['test.com'] = 999;
      // Original should be unaffected
      expect(pm.toLedger().sessionTotal).toBe(1.00);
      expect(pm.getDomainSpending('test.com')).toBe(1.00);
    });
  });
});

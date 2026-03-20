import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MPPHandler } from '../../src/core/mpp-handler';
import type { MPPConfig, MPPChallenge, MPPCredential } from '../../src/core/types';

// ---- Helpers ----

function makeConfig(overrides: Partial<MPPConfig> = {}): MPPConfig {
  return {
    enabled: true,
    paymentMethod: 'stripe_spt',
    credential: 'spt_live_abc123',
    maxPerRequest: 1.00,
    maxPerSession: 5.00,
    autoApprove: true,
    ...overrides,
  };
}

function makeBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'payment_required',
    challenge_id: 'ch_test_123',
    amount: 0.02,
    currency: 'usd',
    recipient: 'acct_abc',
    payment_methods: ['stripe_spt'],
    ...overrides,
  };
}

// ---- Tests ----

describe('MPPHandler', () => {
  describe('isMPPChallenge', () => {
    it('returns true for HTTP 402 with valid MPP body', () => {
      const handler = new MPPHandler(makeConfig());
      expect(handler.isMPPChallenge(402, makeBody())).toBe(true);
    });

    it('returns false for non-402 status codes', () => {
      const handler = new MPPHandler(makeConfig());
      expect(handler.isMPPChallenge(200, makeBody())).toBe(false);
      expect(handler.isMPPChallenge(401, makeBody())).toBe(false);
      expect(handler.isMPPChallenge(403, makeBody())).toBe(false);
    });

    it('returns false for null/undefined body', () => {
      const handler = new MPPHandler(makeConfig());
      expect(handler.isMPPChallenge(402, null)).toBe(false);
      expect(handler.isMPPChallenge(402, undefined)).toBe(false);
    });

    it('detects challenge via challenge_id field (alternative format)', () => {
      const handler = new MPPHandler(makeConfig());
      expect(handler.isMPPChallenge(402, { challenge_id: 'ch_123' })).toBe(true);
    });

    it('detects challenge via camelCase challengeId field', () => {
      const handler = new MPPHandler(makeConfig());
      expect(handler.isMPPChallenge(402, { challengeId: 'ch_123' })).toBe(true);
    });

    it('detects RFC 9457 Problem Details from paymentauth.org', () => {
      const handler = new MPPHandler(makeConfig());
      expect(handler.isMPPChallenge(402, {
        type: 'https://paymentauth.org/problems/verification-failed',
        title: 'Payment Verification Failed',
      })).toBe(true);
    });
  });

  describe('parseChallenge', () => {
    it('parses a standard MPP challenge body', () => {
      const handler = new MPPHandler(makeConfig());
      const challenge = handler.parseChallenge(makeBody(), 'https://api.example.com/data');

      expect(challenge.challengeId).toBe('ch_test_123');
      expect(challenge.amount).toBe(0.02);
      expect(challenge.currency).toBe('usd');
      expect(challenge.recipient).toBe('acct_abc');
      expect(challenge.paymentMethods).toEqual(['stripe_spt']);
      expect(challenge.domain).toBe('api.example.com');
      expect(challenge.resourceUrl).toBe('https://api.example.com/data');
    });

    it('normalizes currency to lowercase', () => {
      const handler = new MPPHandler(makeConfig());
      const challenge = handler.parseChallenge(
        makeBody({ currency: 'USD' }),
        'https://example.com/x'
      );
      expect(challenge.currency).toBe('usd');
    });

    it('handles camelCase field names', () => {
      const handler = new MPPHandler(makeConfig());
      const body = {
        type: 'payment_required',
        challengeId: 'ch_camel',
        amount: 0.05,
        currency: 'eur',
        recipient: 'acct_xyz',
        paymentMethods: ['stripe_spt', 'crypto'],
      };
      const challenge = handler.parseChallenge(body, 'https://test.com/api');
      expect(challenge.challengeId).toBe('ch_camel');
      expect(challenge.paymentMethods).toEqual(['stripe_spt', 'crypto']);
    });

    it('handles missing/malformed fields with defensive defaults', () => {
      const handler = new MPPHandler(makeConfig());
      const body = { type: 'payment_required' }; // minimal body
      const challenge = handler.parseChallenge(body, 'https://test.com/api');
      expect(challenge.challengeId).toBe('');
      expect(challenge.amount).toBe(0);
      expect(challenge.currency).toBe('usd');
      expect(challenge.recipient).toBe('');
      expect(challenge.paymentMethods).toEqual([]);
    });

    it('throws on null body', () => {
      const handler = new MPPHandler(makeConfig());
      expect(() => handler.parseChallenge(null, 'https://test.com')).toThrow();
    });
  });

  describe('shouldApprove', () => {
    const baseChallenge: MPPChallenge = {
      challengeId: 'ch_1',
      amount: 0.02,
      currency: 'usd',
      recipient: 'acct_1',
      paymentMethods: ['stripe_spt'],
      domain: 'example.com',
      resourceUrl: 'https://example.com/resource',
    };

    it('auto-approves small amounts within limits', async () => {
      const handler = new MPPHandler(makeConfig());
      expect(await handler.shouldApprove(baseChallenge)).toBe(true);
    });

    it('rejects amounts exceeding per-request limit', async () => {
      const handler = new MPPHandler(makeConfig({ maxPerRequest: 0.01 }));
      expect(await handler.shouldApprove(baseChallenge)).toBe(false);
    });

    it('rejects amounts exceeding session limit', async () => {
      const handler = new MPPHandler(makeConfig({ maxPerSession: 0.01 }));
      expect(await handler.shouldApprove(baseChallenge)).toBe(false);
    });

    it('calls onPaymentRequired for domains requiring approval', async () => {
      const callback = vi.fn().mockResolvedValue(true);
      const handler = new MPPHandler(makeConfig({ onPaymentRequired: callback }));
      handler.addApprovalDomain('example.com');

      const result = await handler.shouldApprove(baseChallenge);
      expect(callback).toHaveBeenCalledWith(baseChallenge);
      expect(result).toBe(true);
    });

    it('calls onPaymentRequired for amounts above auto-approve but within limits', async () => {
      const callback = vi.fn().mockResolvedValue(true);
      const handler = new MPPHandler(makeConfig({
        autoApprove: false,
        onPaymentRequired: callback,
      }));

      expect(await handler.shouldApprove(baseChallenge)).toBe(true);
      expect(callback).toHaveBeenCalled();
    });

    it('rejects when callback returns false', async () => {
      const callback = vi.fn().mockResolvedValue(false);
      const handler = new MPPHandler(makeConfig({
        autoApprove: false,
        onPaymentRequired: callback,
      }));

      expect(await handler.shouldApprove(baseChallenge)).toBe(false);
    });

    it('rejects when no callback is configured and auto-approve is off', async () => {
      const handler = new MPPHandler(makeConfig({ autoApprove: false }));
      expect(await handler.shouldApprove(baseChallenge)).toBe(false);
    });
  });

  describe('createCredential', () => {
    it('creates a Stripe SPT credential with correct format', async () => {
      const handler = new MPPHandler(makeConfig({ credential: 'spt_live_xyz' }));
      const challenge: MPPChallenge = {
        challengeId: 'ch_42',
        amount: 0.05,
        currency: 'usd',
        recipient: 'acct_1',
        paymentMethods: ['stripe_spt'],
        domain: 'api.com',
        resourceUrl: 'https://api.com/data',
      };

      const cred = await handler.createCredential(challenge);
      expect(cred.scheme).toBe('Payment');
      expect(cred.token).toContain('spt=spt_live_xyz');
      expect(cred.token).toContain('challenge=ch_42');
      expect(cred.token).toContain('amount=0.05');
      expect(cred.token).toContain('currency=usd');
      expect(cred.expiresAt).toBeGreaterThan(Date.now());
    });

    it('throws for crypto_wallet payment method (not yet supported)', async () => {
      const handler = new MPPHandler(makeConfig({ paymentMethod: 'crypto_wallet' }));
      const challenge: MPPChallenge = {
        challengeId: 'ch_1',
        amount: 0.01,
        currency: 'usd',
        recipient: 'addr_1',
        paymentMethods: ['crypto'],
        domain: 'test.com',
        resourceUrl: 'https://test.com/x',
      };

      await expect(handler.createCredential(challenge)).rejects.toThrow('not yet supported');
    });
  });

  describe('handlePaymentRequired — full flow', () => {
    it('completes the full 402 → approve → credential → retry flow', async () => {
      const retryFn = vi.fn().mockResolvedValue({ status: 200 });
      const handler = new MPPHandler(makeConfig());

      const result = await handler.handlePaymentRequired(
        402,
        makeBody({ amount: 0.02 }),
        'https://api.example.com/resource',
        retryFn
      );

      expect(result.paid).toBe(true);
      expect(result.credential).toBeDefined();
      expect(result.credential!.scheme).toBe('Payment');
      expect(result.paymentEvent).toBeDefined();
      expect(result.paymentEvent!.success).toBe(true);
      expect(result.paymentEvent!.amountUsd).toBe(0.02);
      expect(result.paymentEvent!.domain).toBe('api.example.com');
      expect(retryFn).toHaveBeenCalledTimes(1);
    });

    it('records payment in the spending ledger after success', async () => {
      const handler = new MPPHandler(makeConfig());
      await handler.handlePaymentRequired(
        402,
        makeBody({ amount: 0.50 }),
        'https://example.com/x',
        vi.fn().mockResolvedValue({})
      );

      expect(handler.spending.sessionTotal).toBe(0.50);
      expect(handler.spending.requestCount).toBe(1);
    });

    it('returns paid=false for non-MPP responses', async () => {
      const handler = new MPPHandler(makeConfig());
      const result = await handler.handlePaymentRequired(
        200,
        {},
        'https://example.com',
        vi.fn()
      );
      expect(result.paid).toBe(false);
    });

    it('returns paid=false when approval is rejected', async () => {
      const handler = new MPPHandler(makeConfig({ maxPerRequest: 0.01 }));
      const result = await handler.handlePaymentRequired(
        402,
        makeBody({ amount: 0.50 }),
        'https://example.com/x',
        vi.fn()
      );

      expect(result.paid).toBe(false);
      expect(result.paymentEvent?.success).toBe(false);
    });

    it('returns paid=false when retry function throws', async () => {
      const handler = new MPPHandler(makeConfig());
      const result = await handler.handlePaymentRequired(
        402,
        makeBody(),
        'https://example.com/x',
        vi.fn().mockRejectedValue(new Error('Network error'))
      );

      expect(result.paid).toBe(false);
      expect(result.credential).toBeDefined(); // Credential was created before retry failed
      expect(result.paymentEvent?.success).toBe(false);
    });
  });

  describe('ledger management', () => {
    it('resetLedger clears all spending', async () => {
      const handler = new MPPHandler(makeConfig());
      await handler.handlePaymentRequired(402, makeBody(), 'https://x.com/y', vi.fn().mockResolvedValue({}));

      expect(handler.spending.sessionTotal).toBeGreaterThan(0);
      handler.resetLedger();
      expect(handler.spending.sessionTotal).toBe(0);
      expect(handler.spending.requestCount).toBe(0);
    });
  });
});

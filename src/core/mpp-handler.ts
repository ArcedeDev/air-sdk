// ============================================================
// AIR SDK — MPP (Machine Payments Protocol) Handler
// Transparent HTTP 402 detection, challenge parsing, spending
// policy enforcement, credential creation, and request retry.
//
// Protocol reference: https://mpp.dev/protocol
// ============================================================

import type {
  MPPConfig,
  MPPChallenge,
  MPPCredential,
  PaymentEvent,
  SpendingLedger,
} from './types';
import { AIRError } from './types';
import { SpendingPolicyManager } from './spending-policy';

export class MPPHandler {
  private policyManager: SpendingPolicyManager;
  private credential: string;
  private paymentMethod: MPPConfig['paymentMethod'];
  private onPaymentRequired?: (challenge: MPPChallenge) => Promise<boolean>;
  private debug: boolean;

  constructor(config: MPPConfig, debug = false) {
    this.policyManager = new SpendingPolicyManager(config);
    this.credential = config.credential;
    this.paymentMethod = config.paymentMethod;
    this.onPaymentRequired = config.onPaymentRequired;
    this.debug = debug;
  }

  // ---- Challenge Detection ----

  /**
   * Detect whether an HTTP response is an MPP payment challenge.
   *
   * Per the MPP spec, a valid challenge is:
   * - HTTP status 402
   * - Response body containing a `type` field indicating payment is required
   *
   * We also accept the presence of challenge-specific fields for flexibility.
   */
  isMPPChallenge(statusCode: number, responseBody: unknown): boolean {
    if (statusCode !== 402) return false;
    if (!responseBody || typeof responseBody !== 'object') return false;

    const body = responseBody as Record<string, unknown>;

    // Standard MPP: body has type "payment_required" or a challenge_id
    return (
      body.type === 'payment_required' ||
      typeof body.challenge_id === 'string' ||
      typeof body.challengeId === 'string' ||
      // Also detect RFC 9457 Problem Details from failed payment attempts
      (typeof body.type === 'string' && body.type.includes('paymentauth.org'))
    );
  }

  // ---- Challenge Parsing ----

  /**
   * Parse an MPP challenge from a 402 response body.
   * Handles field name variations and provides defensive defaults.
   */
  parseChallenge(responseBody: unknown, requestUrl: string): MPPChallenge {
    if (!responseBody || typeof responseBody !== 'object') {
      throw new AIRError('payment_required', 'Cannot parse MPP challenge: invalid response body');
    }

    const body = responseBody as Record<string, unknown>;
    let domain: string;
    try {
      domain = new URL(requestUrl).hostname;
    } catch {
      domain = 'unknown';
    }

    // Normalize field names: support both camelCase and snake_case
    const challengeId =
      (body.challenge_id as string) ??
      (body.challengeId as string) ??
      (body.id as string) ??
      '';

    const rawAmount = typeof body.amount === 'number' ? body.amount : 0;
    if (rawAmount < 0) {
      throw new AIRError('payment_required', 'Invalid challenge: amount cannot be negative');
    }
    const amount = rawAmount;

    const currency = normalizeCurrency(
      (body.currency as string) ?? 'usd'
    );

    const recipient =
      (body.recipient as string) ?? (body.account as string) ?? '';

    // Payment methods: array or single string
    let paymentMethods: string[] = [];
    if (Array.isArray(body.payment_methods)) {
      paymentMethods = body.payment_methods as string[];
    } else if (Array.isArray(body.paymentMethods)) {
      paymentMethods = body.paymentMethods as string[];
    } else if (typeof body.method === 'string') {
      paymentMethods = [body.method];
    }

    return {
      challengeId,
      amount,
      currency,
      recipient,
      paymentMethods,
      domain,
      resourceUrl: requestUrl,
    };
  }

  // ---- Approval Logic ----

  /**
   * Evaluate whether to approve a payment based on the spending policy.
   *
   * Approval cascade (per brief spec):
   * 1. Check amount <= maxPerRequest  → reject if exceeded
   * 2. Check sessionTotal + amount <= maxPerSession  → reject if exceeded
   * 3. Check domain not in requireApprovalDomains  → force callback if yes
   * 4. Check amount <= autoApproveBelow  → auto-approve
   * 5. Call onPaymentRequired callback  → approve/reject based on return
   */
  async shouldApprove(challenge: MPPChallenge): Promise<boolean> {
    // Steps 1-3: hard policy limits
    const limits = this.policyManager.isWithinLimits(challenge.amount, challenge.domain);

    if (!limits.allowed) {
      if (limits.reason === 'domain_requires_approval') {
        // Domain always requires explicit approval — fall through to callback
        return this.callApprovalCallback(challenge);
      }
      // Over hard limits — reject outright
      this.log(`Payment rejected: ${limits.reason} ($${challenge.amount} on ${challenge.domain})`);
      return false;
    }

    // Step 4: auto-approve if within threshold
    if (this.policyManager.isAutoApprovable(challenge.amount)) {
      this.log(`Auto-approved: $${challenge.amount} on ${challenge.domain}`);
      return true;
    }

    // Step 5: above auto-approve threshold but within limits — ask callback
    return this.callApprovalCallback(challenge);
  }

  // ---- Credential Creation ----

  /**
   * Create an MPP credential for the authorized payment.
   *
   * Per MPP spec, the credential is sent in the `Authorization` header:
   *   Authorization: Payment <credential-payload>
   */
  async createCredential(challenge: MPPChallenge): Promise<MPPCredential> {
    if (this.paymentMethod === 'stripe_spt') {
      // Stripe Shared Payment Token format
      // The SPT is the developer-provided credential token
      const token = `spt=${this.credential},challenge=${challenge.challengeId},amount=${challenge.amount},currency=${challenge.currency}`;
      return {
        scheme: 'Payment',
        token,
        expiresAt: Date.now() + 300_000, // 5 minute validity window
      };
    }

    if (this.paymentMethod === 'crypto_wallet') {
      // Future: sign a payment authorization with the wallet
      throw new AIRError(
        'payment_failed',
        'crypto_wallet payment method is not yet supported. Use stripe_spt.'
      );
    }

    throw new AIRError(
      'payment_failed',
      `Unsupported payment method: ${this.paymentMethod}`
    );
  }

  // ---- Full Flow ----

  /**
   * Complete MPP flow: detect → parse → approve → create credential → retry.
   *
   * The `retryFn` is called with the credential to re-issue the request
   * with the `Authorization: Payment` header. This is provided by the
   * adapter layer (framework-agnostic).
   */
  async handlePaymentRequired(
    statusCode: number,
    responseBody: unknown,
    requestUrl: string,
    retryFn: (credential: MPPCredential) => Promise<unknown>
  ): Promise<{
    paid: boolean;
    credential?: MPPCredential;
    paymentEvent?: PaymentEvent;
  }> {
    // 1. Validate this is actually an MPP challenge
    if (!this.isMPPChallenge(statusCode, responseBody)) {
      return { paid: false };
    }

    // 2. Parse the challenge
    const challenge = this.parseChallenge(responseBody, requestUrl);

    // 3. Evaluate spending policy
    const approved = await this.shouldApprove(challenge);
    if (!approved) {
      this.log(`Payment not approved for ${challenge.domain}: $${challenge.amount}`);
      return {
        paid: false,
        paymentEvent: this.buildPaymentEvent(challenge, false),
      };
    }

    // 4. Create credential
    let credential: MPPCredential;
    try {
      credential = await this.createCredential(challenge);
    } catch (err) {
      this.log(`Credential creation failed: ${err instanceof Error ? err.message : String(err)}`);
      return {
        paid: false,
        paymentEvent: this.buildPaymentEvent(challenge, false),
      };
    }

    // 5. Retry the request with the credential
    try {
      await retryFn(credential);

      // 6. Record the payment in the ledger
      this.policyManager.recordPayment(challenge.domain, challenge.amount);

      this.log(`Payment successful: $${challenge.amount} on ${challenge.domain}`);
      return {
        paid: true,
        credential,
        paymentEvent: this.buildPaymentEvent(challenge, true),
      };
    } catch (err) {
      this.log(`Payment retry failed: ${err instanceof Error ? err.message : String(err)}`);
      return {
        paid: false,
        credential,
        paymentEvent: this.buildPaymentEvent(challenge, false),
      };
    }
  }

  // ---- Accessors ----

  /** Current session spending ledger. */
  get spending(): SpendingLedger {
    return this.policyManager.toLedger();
  }

  /** Reset spending ledger for a new session. */
  resetLedger(): void {
    this.policyManager.reset();
  }

  /** Add a domain that always requires manual approval. */
  addApprovalDomain(domain: string): void {
    this.policyManager.addApprovalDomain(domain);
  }

  // ---- Private Helpers ----

  /**
   * Invoke the developer's approval callback, with a safety timeout.
   * Returns false if no callback is configured.
   */
  private async callApprovalCallback(challenge: MPPChallenge): Promise<boolean> {
    if (!this.onPaymentRequired) {
      this.log('No onPaymentRequired callback configured — rejecting');
      return false;
    }

    try {
      // Wrap callback in a 30-second timeout to prevent indefinite blocking
      const result = await Promise.race([
        this.onPaymentRequired(challenge),
        new Promise<boolean>((_, reject) =>
          setTimeout(() => reject(new Error('Approval callback timed out (30s)')), 30_000)
        ),
      ]);
      return result;
    } catch (err) {
      this.log(`Approval callback error: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /**
   * Build a PaymentEvent for telemetry.
   *
   * `amountUsd` is the raw challenge amount. For non-USD currencies this is
   * an approximation — the cloud telemetry processor can apply live FX rates
   * when aggregating cost data for the capability index.
   */
  private buildPaymentEvent(challenge: MPPChallenge, success: boolean): PaymentEvent {
    return {
      amountUsd: challenge.amount,
      currency: challenge.currency,
      protocol: 'mpp',
      domain: challenge.domain,
      challengeId: challenge.challengeId,
      success,
    };
  }

  private log(message: string): void {
    if (this.debug) {
      console.warn(`[AIR-SDK MPP] ${message}`);
    }
  }
}

// ---- Module Helpers ----

/** Normalize currency codes to lowercase. */
function normalizeCurrency(currency: string): string {
  return currency.toLowerCase().trim();
}

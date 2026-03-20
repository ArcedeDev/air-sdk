import { describe, it, expect } from 'vitest';
import type {
  AIRConfig,
  ResolvedAIRConfig,
  ActionType,
  RecordedAction,
  DOMContext,
  SmartSelector,
  SelectorResolution,
  Macro,
  MacroStep,
  MacroExecutionResult,
  Capability,
  CapabilityParameter,
  CapabilityPricing,
  TelemetryPayload,
  TelemetryEvent,
  TelemetryAction,
  BrowserInfo,
  PageSignals,
  FeedbackPayload,
  CapabilitiesResponse,
  MacroResponse,
  TelemetryResponse,
  AIRErrorCode,
  ExecuteOptions,
  ExecuteResult,
  MPPConfig,
  MPPChallenge,
  MPPCredential,
  SpendingPolicy,
  SpendingLedger,
  PaymentEvent,
  SupportedFramework,
} from '../../src/core/types';
import { AIRError } from '../../src/core/types';

/**
 * These tests verify that all type exports compile correctly and that
 * runtime values conform to the interfaces. TypeScript's type system
 * catches structural issues at compile time; these tests confirm the
 * types are importable and that representative objects satisfy them.
 */

describe('type exports — compile and runtime conformance', () => {
  it('ActionType union accepts all valid values', () => {
    const types: ActionType[] = [
      'navigate', 'click', 'fill', 'type', 'select',
      'check', 'scroll', 'hover', 'press', 'wait',
      'screenshot', 'evaluate',
    ];
    expect(types).toHaveLength(12);
  });

  it('RecordedAction conforms to interface', () => {
    const action: RecordedAction = {
      type: 'click',
      selector: '#submit',
      success: true,
      durationMs: 42,
      timestamp: Date.now(),
    };
    expect(action.type).toBe('click');
    expect(action.value).toBeUndefined();
  });

  it('DOMContext conforms to interface', () => {
    const ctx: DOMContext = {
      tagName: 'BUTTON',
      role: 'button',
      ariaLabel: 'Submit',
      formParent: true,
    };
    expect(ctx.tagName).toBe('BUTTON');
  });

  it('SmartSelector conforms to interface', () => {
    const sel: SmartSelector = {
      primary: '#dest-input',
      fallbacks: ['[data-testid="destination"]'],
      semantic: ['[role="searchbox"]', '[aria-label="Destination"]'],
    };
    expect(sel.fallbacks).toHaveLength(1);
  });

  it('Macro conforms to interface', () => {
    const macro: Macro = {
      id: 'uuid-123',
      domain: 'kayak.com',
      capabilityName: 'search_flights',
      version: 3,
      steps: [{
        action: 'fill',
        selector: '#destination',
        paramsKey: 'destination',
        description: 'Fill destination field',
      }],
      totalSteps: 1,
      confidence: 0.92,
      lastVerifiedAt: '2026-03-18T00:00:00Z',
    };
    expect(macro.steps[0].action).toBe('fill');
  });

  it('MacroExecutionResult conforms to interface', () => {
    const result: MacroExecutionResult = {
      macroId: 'uuid-123',
      version: 3,
      success: true,
      stepsCompleted: 5,
      totalSteps: 5,
      executionTimeMs: 3200,
      selectorResolutions: [{
        usedSelector: '#dest',
        attemptedSelectors: ['#dest'],
        resolutionTimeMs: 2,
      }],
    };
    expect(result.success).toBe(true);
  });

  it('Capability conforms to interface', () => {
    const cap: Capability = {
      id: 'uuid-456',
      domain: 'kayak.com',
      name: 'search_flights',
      description: 'Search for flights',
      parameters: [{
        name: 'destination',
        type: 'string',
        description: 'Destination city or airport',
        required: true,
      }],
      actionType: 'form',
      confidence: 0.89,
      macroAvailable: true,
      macroId: 'macro-uuid-789',
      macroVersion: 3,
      source: 'community',
      lastVerifiedAt: '2026-03-18T00:00:00Z',
    };
    expect(cap.parameters[0].type).toBe('string');
  });

  it('TelemetryPayload includes sdkVersion', () => {
    const payload: TelemetryPayload = {
      apiKeyPrefix: 'air_sdk',
      sdkVersion: '0.1.0',
      events: [],
    };
    expect(payload.sdkVersion).toBe('0.1.0');
  });

  it('TelemetryEvent conforms to interface', () => {
    const event: TelemetryEvent = {
      domain: 'kayak.com',
      path: '/flights',
      actionSequence: [{
        type: 'fill',
        selector: '#destination',
        success: true,
        durationMs: 50,
      }],
      sessionOutcome: 'success',
      browserInfo: {
        framework: 'playwright',
        frameworkVersion: '1.42.0',
        headless: true,
      },
      executionTimeMs: 3200,
      timestamp: new Date().toISOString(),
    };
    expect(event.sessionOutcome).toBe('success');
  });

  it('FeedbackPayload conforms to interface', () => {
    const fb: FeedbackPayload = {
      macroId: 'uuid-123',
      macroVersion: 3,
      success: false,
      failedAtStep: 2,
      failedSelector: '.search-btn',
      errorType: 'selector_not_found',
    };
    expect(fb.errorType).toBe('selector_not_found');
  });

  it('API response types conform to interfaces', () => {
    const capRes: CapabilitiesResponse = {
      capabilities: [],
      domain: 'example.com',
      cached: true,
    };
    expect(capRes.cached).toBe(true);

    const macroRes: MacroResponse = {
      macro: {
        id: 'uuid',
        domain: 'example.com',
        capabilityName: 'test',
        version: 1,
        totalSteps: 0,
        confidence: 0.5,
        lastVerifiedAt: '',
      },
      encryptedSteps: 'base64data',
      sessionKey: 'base64key',
    };
    expect(macroRes.encryptedSteps).toBe('base64data');

    const telRes: TelemetryResponse = {
      accepted: 47,
      rejected: 3,
      executionsUsed: 523,
      executionsLimit: 1000,
    };
    expect(telRes.accepted + telRes.rejected).toBe(50);
  });

  it('AIRError is a proper Error subclass', () => {
    const err = new AIRError('rate_limited', 'Too many requests', 30_000);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AIRError);
    expect(err.code).toBe('rate_limited');
    expect(err.message).toBe('Too many requests');
    expect(err.retryAfterMs).toBe(30_000);
    expect(err.name).toBe('AIRError');
    expect(err.stack).toBeDefined();
  });

  it('MPP types conform to interfaces', () => {
    const challenge: MPPChallenge = {
      challengeId: 'ch_123',
      amount: 0.02,
      currency: 'usd',
      recipient: 'acct_xxx',
      paymentMethods: ['stripe_spt', 'crypto'],
      domain: 'premium-api.com',
      resourceUrl: 'https://premium-api.com/data',
    };
    expect(challenge.amount).toBe(0.02);

    const cred: MPPCredential = {
      scheme: 'MPP',
      token: 'tok_xxx',
      expiresAt: Date.now() + 3600_000,
    };
    expect(cred.scheme).toBe('MPP');

    const payment: PaymentEvent = {
      amountUsd: 0.02,
      currency: 'usd',
      protocol: 'mpp',
      domain: 'premium-api.com',
      challengeId: 'ch_123',
      success: true,
    };
    expect(payment.protocol).toBe('mpp');
  });

  it('ExecuteOptions and ExecuteResult conform to interfaces', () => {
    const opts: ExecuteOptions = {
      capability: 'search_flights',
      domain: 'kayak.com',
      params: { destination: 'Tokyo' },
    };
    expect(opts.params.destination).toBe('Tokyo');

    const result: ExecuteResult = {
      success: true,
      macroUsed: true,
      macroId: 'uuid',
      executionTimeMs: 3200,
      fallbackUsed: false,
    };
    expect(result.macroUsed).toBe(true);
  });

  it('SupportedFramework union is valid', () => {
    const frameworks: SupportedFramework[] = [
      'playwright', 'puppeteer', 'browser-use', 'selenium', 'other',
    ];
    expect(frameworks).toHaveLength(5);
  });
});

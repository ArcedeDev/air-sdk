import { describe, it, expect } from 'vitest';
import {
  resolveConfig,
  validateConfig,
  extractApiKeyPrefix,
  DEFAULT_BASE_URL,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_TELEMETRY_BATCH_SIZE,
  DEFAULT_TELEMETRY_FLUSH_INTERVAL_MS,
} from '../../src/core/config';
import type { AIRConfig, ResolvedAIRConfig } from '../../src/core/types';
import { AIRError } from '../../src/core/types';

// ---- helpers ----

const VALID_KEY = 'air_sdk_test_1234567890abcdef';

function validConfig(overrides?: Partial<AIRConfig>): AIRConfig {
  return { apiKey: VALID_KEY, ...overrides };
}

function expectConfigError(fn: () => void, messageFragment: string): void {
  try {
    fn();
    expect.fail('Expected config error to be thrown');
  } catch (err) {
    expect(err).toBeInstanceOf(AIRError);
    expect(err).toBeInstanceOf(Error);
    const airErr = err as AIRError;
    expect(airErr.code).toBe('invalid_config');
    expect(airErr.message).toContain(messageFragment);
    expect(airErr.name).toBe('AIRError');
    // Verify stack trace exists (non-empty string)
    expect(typeof airErr.stack).toBe('string');
    expect(airErr.stack!.length).toBeGreaterThan(0);
  }
}

// ============================================================
// resolveConfig
// ============================================================

describe('resolveConfig', () => {
  it('applies all defaults when only apiKey is provided', () => {
    const resolved = resolveConfig({ apiKey: VALID_KEY });

    expect(resolved.apiKey).toBe(VALID_KEY);
    expect(resolved.baseURL).toBe(DEFAULT_BASE_URL);
    expect(resolved.telemetryEnabled).toBe(true);
    expect(resolved.cacheEnabled).toBe(true);
    expect(resolved.cacheTTLMs).toBe(DEFAULT_CACHE_TTL_MS);
    expect(resolved.telemetryBatchSize).toBe(DEFAULT_TELEMETRY_BATCH_SIZE);
    expect(resolved.telemetryFlushIntervalMs).toBe(DEFAULT_TELEMETRY_FLUSH_INTERVAL_MS);
    expect(resolved.debug).toBe(false);
    expect(resolved.onError).toBeUndefined();
    expect(resolved.mpp).toBeUndefined();
  });

  it('preserves user overrides', () => {
    const onError = () => {};
    const resolved = resolveConfig({
      apiKey: VALID_KEY,
      baseURL: 'https://custom.api.com',
      telemetryEnabled: false,
      cacheEnabled: false,
      cacheTTLMs: 60_000,
      telemetryBatchSize: 10,
      telemetryFlushIntervalMs: 5_000,
      debug: true,
      onError,
    });

    expect(resolved.baseURL).toBe('https://custom.api.com');
    expect(resolved.telemetryEnabled).toBe(false);
    expect(resolved.cacheEnabled).toBe(false);
    expect(resolved.cacheTTLMs).toBe(60_000);
    expect(resolved.telemetryBatchSize).toBe(10);
    expect(resolved.telemetryFlushIntervalMs).toBe(5_000);
    expect(resolved.debug).toBe(true);
    expect(resolved.onError).toBe(onError);
  });

  it('preserves MPP config when provided', () => {
    const mpp = {
      enabled: true,
      paymentMethod: 'stripe_spt' as const,
      credential: 'spt_live_xxx',
      maxPerRequest: 0.10,
      maxPerSession: 5.00,
      autoApprove: true,
    };
    const resolved = resolveConfig({ apiKey: VALID_KEY, mpp });
    expect(resolved.mpp).toEqual(mpp);
  });

  it('does not mutate the input config', () => {
    const input: AIRConfig = { apiKey: VALID_KEY };
    const frozen = { ...input };
    resolveConfig(input);
    expect(input).toEqual(frozen);
  });

  it('returns a new object on each call', () => {
    const a = resolveConfig({ apiKey: VALID_KEY });
    const b = resolveConfig({ apiKey: VALID_KEY });
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it('strips trailing slashes from baseURL', () => {
    const resolved = resolveConfig({ apiKey: VALID_KEY, baseURL: 'https://api.example.com/' });
    expect(resolved.baseURL).toBe('https://api.example.com');
  });

  it('strips multiple trailing slashes from baseURL', () => {
    const resolved = resolveConfig({ apiKey: VALID_KEY, baseURL: 'https://api.example.com///' });
    expect(resolved.baseURL).toBe('https://api.example.com');
  });

  it('does not modify baseURL without trailing slash', () => {
    const resolved = resolveConfig({ apiKey: VALID_KEY, baseURL: 'https://api.example.com' });
    expect(resolved.baseURL).toBe('https://api.example.com');
  });

  it('strips trailing slash from default baseURL', () => {
    const resolved = resolveConfig({ apiKey: VALID_KEY });
    expect(resolved.baseURL).not.toMatch(/\/$/);
  });
});

// ============================================================
// validateConfig — API key
// ============================================================

describe('validateConfig — apiKey', () => {
  it('accepts a valid api key', () => {
    expect(() => validateConfig(validConfig())).not.toThrow();
  });

  it('rejects missing apiKey', () => {
    expectConfigError(
      () => validateConfig({ apiKey: '' }),
      'apiKey is required',
    );
  });

  it('rejects non-string apiKey', () => {
    expectConfigError(
      () => validateConfig({ apiKey: 123 as any }),
      'apiKey must be a string',
    );
  });

  it('rejects apiKey without correct prefix', () => {
    expectConfigError(
      () => validateConfig({ apiKey: 'sk_test_1234567890' }),
      'must start with "air_"',
    );
  });

  it('rejects apiKey that is too short', () => {
    expectConfigError(
      () => validateConfig({ apiKey: 'air_short' }),
      'too short',
    );
  });
});

// ============================================================
// validateConfig — baseURL
// ============================================================

describe('validateConfig — baseURL', () => {
  it('accepts a valid URL', () => {
    expect(() => validateConfig(validConfig({ baseURL: 'https://custom.api.com' }))).not.toThrow();
  });

  it('rejects empty baseURL', () => {
    expectConfigError(
      () => validateConfig(validConfig({ baseURL: '' })),
      'non-empty string',
    );
  });

  it('rejects invalid URL', () => {
    expectConfigError(
      () => validateConfig(validConfig({ baseURL: 'not-a-url' })),
      'not a valid URL',
    );
  });

  it('skips validation when baseURL is undefined', () => {
    expect(() => validateConfig(validConfig({ baseURL: undefined }))).not.toThrow();
  });
});

// ============================================================
// validateConfig — numeric fields
// ============================================================

describe('validateConfig — numeric fields', () => {
  it('accepts positive cacheTTLMs', () => {
    expect(() => validateConfig(validConfig({ cacheTTLMs: 60_000 }))).not.toThrow();
  });

  it('rejects zero cacheTTLMs', () => {
    expectConfigError(
      () => validateConfig(validConfig({ cacheTTLMs: 0 })),
      'cacheTTLMs must be a positive number',
    );
  });

  it('rejects negative cacheTTLMs', () => {
    expectConfigError(
      () => validateConfig(validConfig({ cacheTTLMs: -1 })),
      'cacheTTLMs must be a positive number',
    );
  });

  it('rejects NaN cacheTTLMs', () => {
    expectConfigError(
      () => validateConfig(validConfig({ cacheTTLMs: NaN })),
      'cacheTTLMs must be a positive number',
    );
  });

  it('rejects non-integer telemetryBatchSize', () => {
    expectConfigError(
      () => validateConfig(validConfig({ telemetryBatchSize: 10.5 })),
      'telemetryBatchSize must be a positive integer',
    );
  });

  it('accepts positive telemetryFlushIntervalMs', () => {
    expect(() => validateConfig(validConfig({ telemetryFlushIntervalMs: 5_000 }))).not.toThrow();
  });

  it('rejects Infinity', () => {
    expectConfigError(
      () => validateConfig(validConfig({ cacheTTLMs: Infinity })),
      'cacheTTLMs must be a positive number',
    );
  });
});

// ============================================================
// validateConfig — MPP
// ============================================================

describe('validateConfig — MPP', () => {
  const validMPP = {
    enabled: true,
    paymentMethod: 'stripe_spt' as const,
    credential: 'spt_live_xxx',
    maxPerRequest: 0.10,
    maxPerSession: 5.00,
    autoApprove: true,
  };

  it('accepts valid MPP config', () => {
    expect(() => validateConfig(validConfig({ mpp: validMPP }))).not.toThrow();
  });

  it('skips MPP validation when disabled', () => {
    expect(() => validateConfig(validConfig({
      mpp: { ...validMPP, enabled: false, credential: '' },
    }))).not.toThrow();
  });

  it('rejects missing credential when enabled', () => {
    expectConfigError(
      () => validateConfig(validConfig({ mpp: { ...validMPP, credential: '' } })),
      'mpp.credential is required',
    );
  });

  it('rejects invalid paymentMethod', () => {
    expectConfigError(
      () => validateConfig(validConfig({ mpp: { ...validMPP, paymentMethod: 'bitcoin' as any } })),
      'mpp.paymentMethod must be',
    );
  });

  it('rejects maxPerRequest exceeding maxPerSession', () => {
    expectConfigError(
      () => validateConfig(validConfig({ mpp: { ...validMPP, maxPerRequest: 10, maxPerSession: 5 } })),
      'cannot exceed',
    );
  });

  it('rejects negative maxPerRequest', () => {
    expectConfigError(
      () => validateConfig(validConfig({ mpp: { ...validMPP, maxPerRequest: -1 } })),
      'mpp.maxPerRequest must be a positive number',
    );
  });
});

// ============================================================
// extractApiKeyPrefix
// ============================================================

describe('extractApiKeyPrefix', () => {
  it('returns first 7 characters', () => {
    expect(extractApiKeyPrefix('air_sdk_test_1234567890')).toBe('air_sdk');
  });

  it('handles short strings gracefully', () => {
    expect(extractApiKeyPrefix('air_x')).toBe('air_x');
  });

  it('returns consistent prefix for same key', () => {
    const key = 'air_sdk_production_key_abc123';
    expect(extractApiKeyPrefix(key)).toBe(extractApiKeyPrefix(key));
  });
});

// ============================================================
// Type exports smoke test
// ============================================================

describe('type exports', () => {
  it('ResolvedAIRConfig has no optional required fields', () => {
    const resolved = resolveConfig({ apiKey: VALID_KEY });
    const requiredKeys: (keyof ResolvedAIRConfig)[] = [
      'apiKey', 'baseURL', 'telemetryEnabled', 'cacheEnabled',
      'cacheTTLMs', 'telemetryBatchSize', 'telemetryFlushIntervalMs', 'debug',
    ];
    for (const key of requiredKeys) {
      expect(resolved[key]).toBeDefined();
    }
  });
});

// ============================================================
// Roundtrip: resolveConfig → validateConfig
// ============================================================

describe('resolveConfig → validateConfig roundtrip', () => {
  it('resolved config always passes validation', () => {
    const resolved = resolveConfig({ apiKey: VALID_KEY });
    expect(() => validateConfig(resolved)).not.toThrow();
  });

  it('resolved config with all overrides passes validation', () => {
    const resolved = resolveConfig({
      apiKey: VALID_KEY,
      baseURL: 'https://custom.api.com',
      telemetryEnabled: false,
      cacheTTLMs: 60_000,
      telemetryBatchSize: 10,
      telemetryFlushIntervalMs: 5_000,
      mpp: {
        enabled: true,
        paymentMethod: 'stripe_spt',
        credential: 'spt_live_xxx',
        maxPerRequest: 0.10,
        maxPerSession: 5.00,
        autoApprove: true,
      },
    });
    expect(() => validateConfig(resolved)).not.toThrow();
  });
});

// ============================================================
// AIRError class behavior
// ============================================================

describe('AIRError', () => {
  it('is an instance of both AIRError and Error', () => {
    const err = new AIRError('network_error', 'Connection failed');
    expect(err).toBeInstanceOf(AIRError);
    expect(err).toBeInstanceOf(Error);
  });

  it('has correct name, code, and message', () => {
    const err = new AIRError('rate_limited', 'Too many requests', 30_000);
    expect(err.name).toBe('AIRError');
    expect(err.code).toBe('rate_limited');
    expect(err.message).toBe('Too many requests');
    expect(err.retryAfterMs).toBe(30_000);
  });

  it('has a stack trace', () => {
    const err = new AIRError('timeout', 'Request timed out');
    expect(err.stack).toBeDefined();
    expect(err.stack).toContain('AIRError');
  });

  it('works in catch blocks', () => {
    let caught = false;
    try {
      throw new AIRError('invalid_key', 'Bad key');
    } catch (e) {
      if (e instanceof AIRError) {
        expect(e.code).toBe('invalid_key');
        caught = true;
      }
    }
    expect(caught).toBe(true);
  });

  it('retryAfterMs is undefined when not provided', () => {
    const err = new AIRError('network_error', 'Offline');
    expect(err.retryAfterMs).toBeUndefined();
  });
});

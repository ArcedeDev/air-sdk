import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';
import { CapabilityCache } from '../../src/core/capability-cache';
import type { ResolvedAIRConfig } from '../../src/core/types';
import type { AIRHttpClient } from '../../src/core/http';

/**
 * Dedicated tests for AES-256-GCM macro step decryption.
 * The decryptSteps method is private, so we test it through getMacro().
 */

function encrypt(steps: any[]): { encryptedSteps: string; sessionKey: string } {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(JSON.stringify(steps), 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const tag = cipher.getAuthTag().toString('base64');

  return {
    encryptedSteps: iv.toString('base64') + '.' + encrypted + '.' + tag,
    sessionKey: key.toString('base64'),
  };
}

const baseMacroResponse = {
  macro: {
    id: 'mac-decrypt-test',
    domain: 'test.com',
    capabilityName: 'test',
    version: 1,
    totalSteps: 2,
    confidence: 0.95,
    lastVerifiedAt: new Date().toISOString(),
  },
};

const mockConfig: ResolvedAIRConfig = {
  apiKey: 'air_test',
  baseURL: 'https://api.test',
  telemetryEnabled: false,
  cacheEnabled: false,
  cacheTTLMs: 1800000,
  telemetryBatchSize: 50,
  telemetryFlushIntervalMs: 30000,
  debug: false,
};

describe('decryptSteps (via getMacro)', () => {
  let cache: CapabilityCache;
  let mockGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGet = vi.fn();
    cache = new CapabilityCache(mockConfig, { get: mockGet } as unknown as AIRHttpClient);
  });

  it('decrypts valid AES-256-GCM encrypted steps', async () => {
    const steps = [
      { action: 'click', selector: '#submit' },
      { action: 'fill', selector: '#email', paramsKey: 'email' },
    ];
    const { encryptedSteps, sessionKey } = encrypt(steps);

    mockGet.mockResolvedValueOnce({ ...baseMacroResponse, encryptedSteps, sessionKey });

    const macro = await cache.getMacro('mac-decrypt-test');
    expect(macro).not.toBeNull();
    expect(macro!.steps).toHaveLength(2);
    expect(macro!.steps[0].action).toBe('click');
    expect(macro!.steps[0].selector).toBe('#submit');
    expect(macro!.steps[1].paramsKey).toBe('email');
  });

  it('decrypts steps with fallback selectors', async () => {
    const steps = [
      {
        action: 'click',
        selector: '#btn',
        fallbackSelectors: ['.btn-primary', '[data-action="submit"]'],
      },
    ];
    const { encryptedSteps, sessionKey } = encrypt(steps);

    mockGet.mockResolvedValueOnce({ ...baseMacroResponse, encryptedSteps, sessionKey });

    const macro = await cache.getMacro('mac-decrypt-test');
    expect(macro!.steps[0].fallbackSelectors).toEqual(['.btn-primary', '[data-action="submit"]']);
  });

  it('returns empty steps on invalid payload format (missing parts)', async () => {
    const onError = vi.fn();
    cache = new CapabilityCache(
      { ...mockConfig, onError },
      { get: mockGet } as unknown as AIRHttpClient,
    );

    mockGet.mockResolvedValueOnce({
      ...baseMacroResponse,
      encryptedSteps: 'invalid-no-dots',
      sessionKey: crypto.randomBytes(32).toString('base64'),
    });

    const macro = await cache.getMacro('mac-decrypt-test');
    expect(macro!.steps).toEqual([]);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'decryption_error' }),
    );
  });

  it('returns empty steps on wrong session key', async () => {
    const onError = vi.fn();
    cache = new CapabilityCache(
      { ...mockConfig, onError },
      { get: mockGet } as unknown as AIRHttpClient,
    );

    const steps = [{ action: 'click', selector: '#btn' }];
    const { encryptedSteps } = encrypt(steps);
    // Use a different key for decryption
    const wrongKey = crypto.randomBytes(32).toString('base64');

    mockGet.mockResolvedValueOnce({
      ...baseMacroResponse,
      encryptedSteps,
      sessionKey: wrongKey,
    });

    const macro = await cache.getMacro('mac-decrypt-test');
    expect(macro!.steps).toEqual([]);
    expect(onError).toHaveBeenCalled();
  });

  it('returns empty steps on tampered ciphertext', async () => {
    const onError = vi.fn();
    cache = new CapabilityCache(
      { ...mockConfig, onError },
      { get: mockGet } as unknown as AIRHttpClient,
    );

    const steps = [{ action: 'click', selector: '#btn' }];
    const { encryptedSteps, sessionKey } = encrypt(steps);

    // Tamper with the ciphertext portion
    const parts = encryptedSteps.split('.');
    parts[1] = Buffer.from('tampered-data').toString('base64');
    const tampered = parts.join('.');

    mockGet.mockResolvedValueOnce({
      ...baseMacroResponse,
      encryptedSteps: tampered,
      sessionKey,
    });

    const macro = await cache.getMacro('mac-decrypt-test');
    expect(macro!.steps).toEqual([]);
    expect(onError).toHaveBeenCalled();
  });

  it('handles null encryptedSteps gracefully', async () => {
    mockGet.mockResolvedValueOnce({
      ...baseMacroResponse,
      encryptedSteps: null,
      sessionKey: null,
    });

    const macro = await cache.getMacro('mac-decrypt-test');
    expect(macro).not.toBeNull();
    expect(macro!.steps).toEqual([]);
  });

  it('decrypts complex multi-step macros', async () => {
    const steps = [
      { action: 'navigate', selector: 'https://example.com/login' },
      { action: 'fill', selector: '#username', paramsKey: 'user' },
      { action: 'fill', selector: '#password', paramsKey: 'pass' },
      { action: 'click', selector: '#login-btn', waitForSelector: '.dashboard' },
      { action: 'click', selector: '.nav-settings', optional: true },
    ];
    const { encryptedSteps, sessionKey } = encrypt(steps);

    mockGet.mockResolvedValueOnce({ ...baseMacroResponse, encryptedSteps, sessionKey });

    const macro = await cache.getMacro('mac-decrypt-test');
    expect(macro!.steps).toHaveLength(5);
    expect(macro!.steps[3].waitForSelector).toBe('.dashboard');
    expect(macro!.steps[4].optional).toBe(true);
  });
});

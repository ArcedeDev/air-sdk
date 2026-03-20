import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as crypto from 'node:crypto';
import { CapabilityCache } from '../../src/core/capability-cache';
import type { ResolvedAIRConfig, Capability, MacroResponse } from '../../src/core/types';
import type { AIRHttpClient } from '../../src/core/http';

const mockConfig: ResolvedAIRConfig = {
  apiKey: 'air_test',
  baseURL: 'https://api.test',
  telemetryEnabled: true,
  cacheEnabled: true,
  cacheTTLMs: 1800000, // 30 mins
  telemetryBatchSize: 50,
  telemetryFlushIntervalMs: 30000,
  debug: false,
};

describe('CapabilityCache', () => {
  let cache: CapabilityCache;
  let mockHttpClient: Partial<AIRHttpClient>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockHttpClient = {
      get: vi.fn() as any,
    };
    cache = new CapabilityCache(mockConfig, mockHttpClient as AIRHttpClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const sampleCapability: Capability = {
    id: 'cap-1',
    domain: 'test.com',
    name: 'test_cap',
    description: 'Test',
    parameters: [],
    actionType: 'navigate',
    confidence: 0.9,
    macroAvailable: true,
    macroId: 'mac-1',
    source: 'community',
    lastVerifiedAt: new Date().toISOString()
  };

  it('preloads capabilities and macros', async () => {
    const mockGet = mockHttpClient.get as any;
    // Mock capability endpoint
    mockGet.mockResolvedValueOnce({ capabilities: [sampleCapability], domain: 'test.com', cached: false });
    // Mock macro endpoint
    mockGet.mockResolvedValueOnce({
      macro: {
        id: 'mac-1',
        domain: 'test.com',
        capabilityName: 'test_cap',
        version: 1,
        totalSteps: 1,
        confidence: 0.9,
        lastVerifiedAt: new Date().toISOString()
      },
      encryptedSteps: null,
      sessionKey: null
    });

    const caps = await cache.preload('test.com');
    expect(caps.length).toBe(1);
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(mockGet.mock.calls[0][0]).toBe('/api/v1/sdk/capabilities');
    expect(mockGet.mock.calls[1][0]).toBe('/api/v1/sdk/macro/mac-1');
  });

  it('returns from cache on second read (cache hit)', async () => {
    const mockGet = mockHttpClient.get as any;
    mockGet.mockResolvedValueOnce({ capabilities: [sampleCapability], domain: 'test.com', cached: false });

    await cache.getCapabilities('test.com');
    await cache.getCapabilities('test.com');

    expect(mockGet).toHaveBeenCalledTimes(1); // Cached
  });

  it('refetches when cache TTL expires', async () => {
    const mockGet = mockHttpClient.get as any;
    mockGet.mockResolvedValue({ capabilities: [sampleCapability], domain: 'test.com', cached: false });

    await cache.getCapabilities('test.com');
    // Fast-forward 31 mins
    vi.advanceTimersByTime(31 * 60 * 1000);
    await cache.getCapabilities('test.com');

    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('builds smart selectors from macro steps', async () => {
    const mockGet = mockHttpClient.get as any;
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    
    const steps = [
      { action: 'click', selector: '#btn', fallbackSelectors: ['.btn-alt'] }
    ];
    let encrypted = cipher.update(JSON.stringify(steps), 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const tag = cipher.getAuthTag().toString('base64');
    
    // Using concatenation instead of template literals
    const encryptedSteps = iv.toString('base64') + '.' + encrypted + '.' + tag;
    const sessionKey = key.toString('base64');

    mockGet.mockResolvedValueOnce({
      macro: {
        id: 'mac-test',
        domain: 'example.com',
        capabilityName: 'cap',
        version: 1,
        totalSteps: 1,
        confidence: 0.9,
        lastVerifiedAt: new Date().toISOString()
      },
      encryptedSteps,
      sessionKey
    });

    const macro = await cache.getMacro('mac-test');
    expect(macro?.steps[0].selector).toBe('#btn');

    // Verify smart selector was built
    const smart = cache.getSmartSelector('example.com', '#btn');
    expect(smart?.primary).toBe('#btn');
    expect(smart?.fallbacks).toContain('.btn-alt');
  });

  it('handles network errors without throwing', async () => {
    const mockGet = mockHttpClient.get as any;
    mockGet.mockRejectedValue(new Error('Network error'));
    
    const onError = vi.fn();
    cache = new CapabilityCache({ ...mockConfig, onError }, mockHttpClient as AIRHttpClient);
    
    const caps = await cache.getCapabilities('test.com');
    expect(caps).toEqual([]);
    expect(onError).toHaveBeenCalled();
  });

  it('clears cache successfully', async () => {
    const mockGet = mockHttpClient.get as any;
    mockGet.mockResolvedValueOnce({ capabilities: [sampleCapability], domain: 'test.com', cached: false });
    
    await cache.getCapabilities('test.com');
    expect(cache.stats.capabilities).toBe(1);
    
    cache.clear();
    expect(cache.stats.capabilities).toBe(0);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSDKComponents } from '../../src/adapters/base-adapter';
import type { BrowserInfo } from '../../src/core/types';

// Mock fetch to prevent network calls during component wiring
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ capabilities: [] }),
}));

const TEST_CONFIG = { apiKey: 'air_test_1234567890' };
const TEST_BROWSER_INFO: BrowserInfo = {
  framework: 'playwright',
  frameworkVersion: '1.42.0',
  headless: true,
};

describe('createSDKComponents', () => {
  it('returns all expected component fields', () => {
    const sdk = createSDKComponents(TEST_CONFIG, TEST_BROWSER_INFO);

    expect(sdk.config).toBeDefined();
    expect(sdk.config.apiKey).toBe('air_test_1234567890');
    expect(sdk.httpClient).toBeDefined();
    expect(sdk.cache).toBeDefined();
    expect(sdk.smartSelector).toBeDefined();
    expect(sdk.privacyFilter).toBeDefined();
    expect(sdk.observer).toBeDefined();
    expect(sdk.telemetry).toBeDefined();
    expect(sdk.macroRunner).toBeDefined();
    expect(sdk.executor).toBeDefined();
  });

  it('resolves config with defaults', () => {
    const sdk = createSDKComponents(TEST_CONFIG, TEST_BROWSER_INFO);

    expect(sdk.config.baseURL).toBe('https://api.agentinternetruntime.com');
    expect(sdk.config.telemetryEnabled).toBe(true);
    expect(sdk.config.cacheEnabled).toBe(true);
  });

  it('validates config and rejects invalid keys', () => {
    expect(() => createSDKComponents({ apiKey: '' }, TEST_BROWSER_INFO)).toThrow();
    expect(() => createSDKComponents({ apiKey: 'bad_key' }, TEST_BROWSER_INFO)).toThrow();
  });

  it('returns independent instances per call', () => {
    const a = createSDKComponents(TEST_CONFIG, TEST_BROWSER_INFO);
    const b = createSDKComponents(TEST_CONFIG, TEST_BROWSER_INFO);

    expect(a.cache).not.toBe(b.cache);
    expect(a.observer).not.toBe(b.observer);
    expect(a.executor).not.toBe(b.executor);
  });

  it('observer flushes to telemetry via onFlush wiring', async () => {
    const sdk = createSDKComponents(TEST_CONFIG, TEST_BROWSER_INFO);

    // Enqueue is the telemetry entry point — verify the wiring connects
    const enqueueSpy = vi.spyOn(sdk.telemetry, 'enqueue');

    // Simulate the observer flush path:
    // 1. Set a domain (otherwise flush is a no-op)
    await sdk.observer.onNavigate('https://example.com');
    // 2. Record an action
    sdk.observer.record({
      type: 'click',
      selector: '#btn',
      success: true,
      durationMs: 10,
      timestamp: Date.now(),
    });
    // 3. Flush
    await sdk.observer.flush();

    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    const event = enqueueSpy.mock.calls[0][0];
    expect(event.domain).toBe('example.com');
    expect(event.actionSequence.length).toBe(1);
  });
});

describe('AbstractPageAdapter lifecycle', () => {
  // Test via the Playwright adapter since AbstractPageAdapter is abstract
  let withAIR: typeof import('../../src/adapters/playwright').withAIR;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../../src/adapters/playwright');
    withAIR = mod.withAIR;
  });

  it('destroy() is idempotent — second call is a no-op', async () => {
    const mockPage = {
      goto: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
      fill: vi.fn().mockResolvedValue(undefined),
      selectOption: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(null),
      close: vi.fn().mockResolvedValue(undefined),
      viewportSize: vi.fn().mockReturnValue(null),
      context: vi.fn().mockReturnValue(null),
    };

    const smartPage = withAIR(mockPage, TEST_CONFIG);
    await smartPage.destroy();
    // Second call should not throw
    await smartPage.destroy();
  });

  it('wrapped page exposes .air and .destroy', () => {
    const mockPage = {
      fill: vi.fn(), selectOption: vi.fn(),
      evaluate: vi.fn(), viewportSize: vi.fn().mockReturnValue(null),
      context: vi.fn().mockReturnValue(null),
    };

    const smartPage = withAIR(mockPage, TEST_CONFIG);
    expect(smartPage.air).toBeDefined();
    expect(typeof smartPage.destroy).toBe('function');
  });
});

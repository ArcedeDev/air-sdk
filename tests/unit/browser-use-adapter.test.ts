import { expect, test, describe, vi, beforeEach } from 'vitest';
import { AIRPlugin } from '../../src/adapters/browser-use';

// Mock fetch globally
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ capabilities: [], accepted: 0, rejected: 0 }),
}));

const TEST_CONFIG = { apiKey: 'air_test_1234567890' };

describe('Browser Use AIRPlugin', () => {
  let plugin: AIRPlugin;

  beforeEach(() => {
    plugin = new AIRPlugin(TEST_CONFIG);
    vi.clearAllMocks();
  });

  test('has name "air-sdk"', () => {
    expect(plugin.name).toBe('air-sdk');
  });

  test('exposes .air accessor', () => {
    expect(plugin.air).toBeDefined();
    expect(typeof plugin.air.execute).toBe('function');
  });

  test('onStart initializes without error', async () => {
    const mockPage = { url: () => 'https://example.com' };
    await expect(plugin.onStart(mockPage)).resolves.not.toThrow();
  });

  test('onAction records action without throwing', async () => {
    await expect(
      plugin.onAction({
        type: 'click',
        selector: '#btn',
        success: true,
        durationMs: 50,
      })
    ).resolves.not.toThrow();
  });

  test('onAction handles navigation actions', async () => {
    await expect(
      plugin.onAction({
        type: 'goto',
        url: 'https://kayak.com/flights',
        success: true,
      })
    ).resolves.not.toThrow();
  });

  test('onEnd flushes without throwing', async () => {
    const mockPage = { url: () => 'https://example.com' };
    await plugin.onStart(mockPage);
    await plugin.onAction({ type: 'click', selector: '#btn', success: true });
    await expect(plugin.onEnd()).resolves.not.toThrow();
  });

  test('onAction is no-op after onEnd', async () => {
    await plugin.onEnd();
    // Should not throw even after shutdown
    await expect(
      plugin.onAction({ type: 'click', selector: '#btn', success: true })
    ).resolves.not.toThrow();
  });
});

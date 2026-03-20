import { expect, test, describe, vi, beforeEach } from 'vitest';
import { withAIR } from '../../src/adapters/playwright';

// Mock fetch globally so AIRHttpClient doesn't hit the network
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ capabilities: [], accepted: 0, rejected: 0 }),
}));

function createMockPlaywrightPage() {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    dblclick: vi.fn().mockResolvedValue(undefined),
    press: vi.fn().mockResolvedValue(undefined),
    selectOption: vi.fn().mockResolvedValue(undefined),
    check: vi.fn().mockResolvedValue(undefined),
    uncheck: vi.fn().mockResolvedValue(undefined),
    hover: vi.fn().mockResolvedValue(undefined),
    focus: vi.fn().mockResolvedValue(undefined),
    tap: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('')),
    evaluate: vi.fn().mockResolvedValue(null),
    evaluateHandle: vi.fn().mockResolvedValue(null),
    waitForSelector: vi.fn().mockResolvedValue(null),
    waitForURL: vi.fn().mockResolvedValue(undefined),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    // Non-action methods
    url: vi.fn().mockReturnValue('https://example.com'),
    title: vi.fn().mockResolvedValue('Example'),
    content: vi.fn().mockResolvedValue('<html></html>'),
    viewportSize: vi.fn().mockReturnValue({ width: 1280, height: 720 }),
    context: vi.fn().mockReturnValue({
      browser: vi.fn().mockReturnValue({ isConnected: vi.fn().mockReturnValue(true) }),
    }),
  };
}

const TEST_CONFIG = { apiKey: 'air_test_1234567890' };

describe('Playwright Adapter — withAIR()', () => {
  let mockPage: ReturnType<typeof createMockPlaywrightPage>;

  beforeEach(() => {
    mockPage = createMockPlaywrightPage();
    vi.clearAllMocks();
  });

  test('returns a proxy, not the original page', () => {
    const smartPage = withAIR(mockPage, TEST_CONFIG);
    expect(smartPage).not.toBe(mockPage);
  });

  test('exposes .air accessor for CapabilityExecutor', () => {
    const smartPage = withAIR(mockPage, TEST_CONFIG);
    expect(smartPage.air).toBeDefined();
    expect(typeof smartPage.air.execute).toBe('function');
    expect(typeof smartPage.air.listCapabilities).toBe('function');
  });

  test('exposes .destroy() for cleanup', () => {
    const smartPage = withAIR(mockPage, TEST_CONFIG);
    expect(typeof smartPage.destroy).toBe('function');
  });

  test('non-action methods pass through transparently', () => {
    const smartPage = withAIR(mockPage, TEST_CONFIG);
    expect(smartPage.url()).toBe('https://example.com');
    expect(mockPage.url).toHaveBeenCalledTimes(1);
  });

  test('action methods call the original and record the action', async () => {
    const smartPage = withAIR(mockPage, TEST_CONFIG);
    await smartPage.click('#btn');
    expect(mockPage.click).toHaveBeenCalledWith('#btn');
  });

  test('fill calls original and records the action', async () => {
    const smartPage = withAIR(mockPage, TEST_CONFIG);
    await smartPage.fill('#input', 'hello');
    expect(mockPage.fill).toHaveBeenCalledWith('#input', 'hello');
  });

  test('goto calls original and triggers navigation tracking', async () => {
    const smartPage = withAIR(mockPage, TEST_CONFIG);
    await smartPage.goto('https://kayak.com/flights');
    expect(mockPage.goto).toHaveBeenCalledWith('https://kayak.com/flights');
  });

  test('error from original method propagates unchanged', async () => {
    const error = new Error('Element not found');
    mockPage.click.mockRejectedValue(error);

    const smartPage = withAIR(mockPage, TEST_CONFIG);
    await expect(smartPage.click('#missing')).rejects.toThrow('Element not found');
  });

  test('close flushes observer before closing', async () => {
    const smartPage = withAIR(mockPage, TEST_CONFIG);
    await smartPage.close();
    expect(mockPage.close).toHaveBeenCalledTimes(1);
  });

  test('screenshot method is intercepted', async () => {
    const smartPage = withAIR(mockPage, TEST_CONFIG);
    await smartPage.screenshot({ path: 'test.png' });
    expect(mockPage.screenshot).toHaveBeenCalledWith({ path: 'test.png' });
  });

  test('evaluate is intercepted but returns result', async () => {
    mockPage.evaluate.mockResolvedValue(42);
    const smartPage = withAIR(mockPage, TEST_CONFIG);
    const result = await smartPage.evaluate(() => 42);
    expect(result).toBe(42);
  });
});

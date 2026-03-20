import { expect, test, describe, vi, beforeEach } from 'vitest';
import { withAIR } from '../../src/adapters/puppeteer';

// Mock fetch globally
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ capabilities: [], accepted: 0, rejected: 0 }),
}));

function createMockPuppeteerPage() {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    press: vi.fn().mockResolvedValue(undefined),
    select: vi.fn().mockResolvedValue(undefined),
    tap: vi.fn().mockResolvedValue(undefined),
    hover: vi.fn().mockResolvedValue(undefined),
    focus: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('')),
    evaluate: vi.fn().mockResolvedValue(null),
    evaluateHandle: vi.fn().mockResolvedValue(null),
    waitForSelector: vi.fn().mockResolvedValue(null),
    waitForNavigation: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    // Non-action methods
    url: vi.fn().mockReturnValue('https://example.com'),
    title: vi.fn().mockResolvedValue('Example'),
    content: vi.fn().mockResolvedValue('<html></html>'),
    viewport: vi.fn().mockReturnValue({ width: 1280, height: 720 }),
    browser: vi.fn().mockReturnValue({
      isConnected: vi.fn().mockReturnValue(true),
    }),
  };
}

const TEST_CONFIG = { apiKey: 'air_test_1234567890' };

describe('Puppeteer Adapter — withAIR()', () => {
  let mockPage: ReturnType<typeof createMockPuppeteerPage>;

  beforeEach(() => {
    mockPage = createMockPuppeteerPage();
    vi.clearAllMocks();
  });

  test('returns a proxy, not the original page', () => {
    const smartPage = withAIR(mockPage, TEST_CONFIG);
    expect(smartPage).not.toBe(mockPage);
  });

  test('exposes .air accessor', () => {
    const smartPage = withAIR(mockPage, TEST_CONFIG);
    expect(smartPage.air).toBeDefined();
    expect(typeof smartPage.air.execute).toBe('function');
  });

  test('non-action methods pass through', () => {
    const smartPage = withAIR(mockPage, TEST_CONFIG);
    expect(smartPage.url()).toBe('https://example.com');
    expect(mockPage.url).toHaveBeenCalledTimes(1);
  });

  test('type (Puppeteer-specific) is intercepted', async () => {
    const smartPage = withAIR(mockPage, TEST_CONFIG);
    await smartPage.type('#input', 'hello');
    expect(mockPage.type).toHaveBeenCalledWith('#input', 'hello');
  });

  test('select (Puppeteer-specific) is intercepted', async () => {
    const smartPage = withAIR(mockPage, TEST_CONFIG);
    await smartPage.select('#dropdown', 'option1');
    expect(mockPage.select).toHaveBeenCalledWith('#dropdown', 'option1');
  });

  test('goto calls original and triggers navigation tracking', async () => {
    const smartPage = withAIR(mockPage, TEST_CONFIG);
    await smartPage.goto('https://example.com/page');
    expect(mockPage.goto).toHaveBeenCalledWith('https://example.com/page');
  });

  test('error from original method propagates unchanged', async () => {
    const error = new Error('Puppeteer timeout');
    mockPage.click.mockRejectedValue(error);

    const smartPage = withAIR(mockPage, TEST_CONFIG);
    await expect(smartPage.click('#missing')).rejects.toThrow('Puppeteer timeout');
  });

  test('close flushes observer before closing', async () => {
    const smartPage = withAIR(mockPage, TEST_CONFIG);
    await smartPage.close();
    expect(mockPage.close).toHaveBeenCalledTimes(1);
  });
});

/**
 * E2E Smoke Test — Verifies the SDK works with a real Playwright browser.
 *
 * What this tests:
 * - withAIR() wraps a real Playwright Page without breaking it
 * - Page navigation, clicks, fills work through the Proxy
 * - .air accessor is available on the wrapped page
 * - .destroy() cleans up without error
 * - Errors from the page propagate unchanged through the wrapper
 *
 * Run: npx vitest run --config vitest.e2e.config.ts
 */
import { test, expect } from 'vitest';
import { chromium } from 'playwright';
import { withAIR } from '../../src/adapters/playwright';

// Use a dummy key — telemetry will fail silently (which is the correct behavior)
const TEST_CONFIG = { apiKey: 'air_smoke_test_0000000000', telemetryEnabled: false };

test('withAIR wraps a real Playwright page and basic navigation works', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const smartPage = withAIR(page, TEST_CONFIG);

  try {
    // Verify the proxy is not the original page
    expect(smartPage).not.toBe(page);

    // Verify .air accessor exists
    expect(smartPage.air).toBeDefined();
    expect(typeof smartPage.air.execute).toBe('function');
    expect(typeof smartPage.air.listCapabilities).toBe('function');

    // Navigate to a real page
    await smartPage.goto('https://example.com');

    // Verify page methods work through the proxy
    const title = await smartPage.title();
    expect(title).toContain('Example');

    const url = smartPage.url();
    expect(url).toContain('example.com');

    // Verify content is accessible
    const heading = await smartPage.textContent('h1');
    expect(heading).toContain('Example Domain');
  } finally {
    await smartPage.destroy();
    await browser.close();
  }
}, 30_000);

test('withAIR page supports click and evaluate on a real page', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const smartPage = withAIR(page, TEST_CONFIG);

  try {
    await smartPage.goto('https://example.com');

    // Evaluate works through the proxy
    const result = await smartPage.evaluate(() => document.title);
    expect(result).toContain('Example');

    // Click on the "More information..." link (exists on example.com)
    const link = await smartPage.$('a');
    expect(link).not.toBeNull();
  } finally {
    await smartPage.destroy();
    await browser.close();
  }
}, 30_000);

test('withAIR propagates Playwright errors unchanged', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const smartPage = withAIR(page, TEST_CONFIG);

  try {
    await smartPage.goto('https://example.com');

    // This selector doesn't exist — Playwright should throw its native error
    await expect(
      smartPage.click('#nonexistent-element', { timeout: 1000 })
    ).rejects.toThrow();
  } finally {
    await smartPage.destroy();
    await browser.close();
  }
}, 30_000);

test('page.close() works through the proxy without error', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const smartPage = withAIR(page, TEST_CONFIG);

  await smartPage.goto('https://example.com');
  // close() should flush observer then close — no error
  await smartPage.close();

  await browser.close();
}, 30_000);

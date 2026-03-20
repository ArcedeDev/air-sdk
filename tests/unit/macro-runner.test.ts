import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MacroRunner, detectFramework } from '../../src/core/macro-runner';
import type { Macro } from '../../src/core/types';
import type { SmartSelectorResolver } from '../../src/core/smart-selector';

// ---------------------------------------------------------------------------
// detectFramework
// ---------------------------------------------------------------------------
describe('detectFramework', () => {
  it('detects playwright when fill() and selectOption() exist', () => {
    expect(detectFramework({ fill: vi.fn(), selectOption: vi.fn() })).toBe('playwright');
  });

  it('detects puppeteer when fill() is missing', () => {
    expect(detectFramework({ type: vi.fn(), select: vi.fn() })).toBe('puppeteer');
  });

  it('detects puppeteer when selectOption() is missing', () => {
    expect(detectFramework({ fill: vi.fn(), type: vi.fn() })).toBe('puppeteer');
  });
});

// ---------------------------------------------------------------------------
// MacroRunner
// ---------------------------------------------------------------------------
describe('MacroRunner', () => {
  let mockPage: any;
  let mockResolver: any;
  let runner: MacroRunner;

  beforeEach(() => {
    mockPage = {
      click: vi.fn().mockResolvedValue(undefined),
      fill: vi.fn().mockResolvedValue(undefined),
      type: vi.fn().mockResolvedValue(undefined),
      hover: vi.fn().mockResolvedValue(undefined),
      selectOption: vi.fn().mockResolvedValue(undefined),
      check: vi.fn().mockResolvedValue(undefined),
      press: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      $: vi.fn().mockResolvedValue(null),
    };
    mockResolver = {
      resolve: vi.fn().mockImplementation(async (_p: any, selector: string) => ({
        usedSelector: selector,
        attemptedSelectors: [selector],
        resolutionTimeMs: 1
      }))
    };
    runner = new MacroRunner(mockResolver as SmartSelectorResolver);
  });

  // --- Basic execution ---
  it('executes a simple 3-step macro successfully', async () => {
    const macro: Macro = {
      id: 'm1', domain: 'test.com', capabilityName: 'test', version: 1,
      confidence: 1, lastVerifiedAt: '', totalSteps: 3,
      steps: [
        { action: 'click', selector: '#btn1' },
        { action: 'fill', selector: '#input1' },
        { action: 'click', selector: '#btn2' },
      ]
    };
    const result = await runner.execute(mockPage, macro, {});

    expect(result.success).toBe(true);
    expect(result.stepsCompleted).toBe(3);
    expect(result.totalSteps).toBe(3);
    expect(result.macroId).toBe('m1');
    expect(result.version).toBe(1);
    expect(result.failedAtStep).toBeUndefined();
  });

  // --- Parameter substitution ---
  it('resolves parameterised macro steps from params map', async () => {
    const macro: Macro = {
      id: 'm2', domain: 'test.com', capabilityName: 'test', version: 1,
      confidence: 1, lastVerifiedAt: '', totalSteps: 1,
      steps: [{ action: 'fill', selector: '#input', paramsKey: 'dest' }]
    };
    const result = await runner.execute(mockPage, macro, { dest: 'Tokyo' });

    expect(result.success).toBe(true);
    expect(mockPage.fill).toHaveBeenCalledWith('#input', 'Tokyo', expect.any(Object));
  });

  // --- Selector fallback ---
  it('falls back to secondary selector when primary fails', async () => {
    const macro: Macro = {
      id: 'm3', domain: 'test.com', capabilityName: 'test', version: 1,
      confidence: 1, lastVerifiedAt: '', totalSteps: 1,
      steps: [{ action: 'click', selector: '#fail', fallbackSelectors: ['#ok'] }]
    };
    mockPage.click = vi.fn().mockImplementation(async (sel: string) => {
      if (sel === '#fail') throw new Error('Not found');
    });

    const result = await runner.execute(mockPage, macro, {});

    expect(result.success).toBe(true);
    expect(result.stepsCompleted).toBe(1);
    expect(mockPage.click).toHaveBeenCalledWith('#fail', expect.any(Object));
    expect(mockPage.click).toHaveBeenCalledWith('#ok', expect.any(Object));
  });

  // --- Optional step skip ---
  it('skips optional steps on failure and continues', async () => {
    const macro: Macro = {
      id: 'm4', domain: 'test.com', capabilityName: 'test', version: 1,
      confidence: 1, lastVerifiedAt: '', totalSteps: 2,
      steps: [
        { action: 'click', selector: '#fail', optional: true },
        { action: 'click', selector: '#ok' }
      ]
    };
    mockPage.click = vi.fn().mockImplementation(async (sel: string) => {
      if (sel === '#fail') throw new Error('Not found');
    });

    const result = await runner.execute(mockPage, macro, {});

    expect(result.success).toBe(true);
    // Only the second step succeeded
    expect(result.stepsCompleted).toBe(1);
  });

  // --- Required step failure ---
  it('returns failure when a required step fails all selectors', async () => {
    const macro: Macro = {
      id: 'm5', domain: 'test.com', capabilityName: 'test', version: 1,
      confidence: 1, lastVerifiedAt: '', totalSteps: 1,
      steps: [{ action: 'click', selector: '#broken' }]
    };
    mockPage.click = vi.fn().mockRejectedValue(new Error('Not found'));

    const result = await runner.execute(mockPage, macro, {});

    expect(result.success).toBe(false);
    expect(result.failedAtStep).toBe(0);
    expect(result.failedSelector).toBe('#broken');
  });

  // --- Progress callback ---
  it('fires onStepComplete with correct step numbers', async () => {
    const macro: Macro = {
      id: 'm6', domain: 'test.com', capabilityName: 'test', version: 1,
      confidence: 1, lastVerifiedAt: '', totalSteps: 2,
      steps: [
        { action: 'click', selector: '#a' },
        { action: 'click', selector: '#b' }
      ]
    };
    const cb = vi.fn();
    await runner.execute(mockPage, macro, {}, { onStepComplete: cb });

    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenNthCalledWith(1, 1, 2);
    expect(cb).toHaveBeenNthCalledWith(2, 2, 2);
  });

  // --- Timeout ---
  it('returns failure when total timeout is exceeded', async () => {
    const macro: Macro = {
      id: 'm7', domain: 'test.com', capabilityName: 'test', version: 1,
      confidence: 1, lastVerifiedAt: '', totalSteps: 1,
      steps: [{ action: 'click', selector: '#slow' }]
    };
    // Make click never resolve within timeout
    mockPage.click = vi.fn().mockImplementation(() => new Promise(r => setTimeout(r, 5000)));

    const result = await runner.execute(mockPage, macro, {}, { timeout: 50 });

    expect(result.success).toBe(false);
  });

  // --- AbortSignal ---
  it('aborts execution when abortSignal fires', async () => {
    const macro: Macro = {
      id: 'm8', domain: 'test.com', capabilityName: 'test', version: 1,
      confidence: 1, lastVerifiedAt: '', totalSteps: 2,
      steps: [
        { action: 'click', selector: '#a' },
        { action: 'click', selector: '#b' }
      ]
    };
    const ac = new AbortController();
    // Abort before first step even starts
    ac.abort();

    const result = await runner.execute(mockPage, macro, {}, { abortSignal: ac.signal });

    expect(result.success).toBe(false);
  });

  // --- waitMs / waitForSelector ---
  it('honors waitMs between steps', async () => {
    const macro: Macro = {
      id: 'm9', domain: 'test.com', capabilityName: 'test', version: 1,
      confidence: 1, lastVerifiedAt: '', totalSteps: 1,
      steps: [{ action: 'click', selector: '#a', waitMs: 100 }]
    };
    const start = Date.now();
    await runner.execute(mockPage, macro, {});
    const elapsed = Date.now() - start;

    // Should have waited ~100ms
    expect(elapsed).toBeGreaterThanOrEqual(80);
  });

  it('honors waitForSelector after step', async () => {
    const macro: Macro = {
      id: 'm10', domain: 'test.com', capabilityName: 'test', version: 1,
      confidence: 1, lastVerifiedAt: '', totalSteps: 1,
      steps: [{ action: 'click', selector: '#a', waitForSelector: '.result' }]
    };
    await runner.execute(mockPage, macro, {});

    expect(mockPage.waitForSelector).toHaveBeenCalledWith('.result', { timeout: 5000 });
  });

  // --- All action types ---
  it('executes navigate action with page.goto', async () => {
    const macro: Macro = {
      id: 'nav', domain: 'test.com', capabilityName: 'test', version: 1,
      confidence: 1, lastVerifiedAt: '', totalSteps: 1,
      steps: [{ action: 'navigate', selector: 'https://example.com' }]
    };
    await runner.execute(mockPage, macro, {});
    expect(mockPage.goto).toHaveBeenCalledWith('https://example.com', expect.any(Object));
  });

  it('executes hover action', async () => {
    const macro: Macro = {
      id: 'hov', domain: 'test.com', capabilityName: 'test', version: 1,
      confidence: 1, lastVerifiedAt: '', totalSteps: 1,
      steps: [{ action: 'hover', selector: '#menu' }]
    };
    await runner.execute(mockPage, macro, {});
    expect(mockPage.hover).toHaveBeenCalledWith('#menu');
  });

  it('executes select action (Playwright)', async () => {
    const macro: Macro = {
      id: 'sel', domain: 'test.com', capabilityName: 'test', version: 1,
      confidence: 1, lastVerifiedAt: '', totalSteps: 1,
      steps: [{ action: 'select', selector: '#dropdown', paramsKey: 'val' }]
    };
    await runner.execute(mockPage, macro, { val: 'opt1' });
    expect(mockPage.selectOption).toHaveBeenCalledWith('#dropdown', 'opt1', expect.any(Object));
  });

  it('executes check action (Playwright)', async () => {
    const macro: Macro = {
      id: 'chk', domain: 'test.com', capabilityName: 'test', version: 1,
      confidence: 1, lastVerifiedAt: '', totalSteps: 1,
      steps: [{ action: 'check', selector: '#agree' }]
    };
    await runner.execute(mockPage, macro, {});
    expect(mockPage.check).toHaveBeenCalledWith('#agree', expect.any(Object));
  });

  it('executeStep returns error when no selector for click', async () => {
    const result = await runner.executeStep(
      mockPage,
      { action: 'click' },
      undefined,
      5000,
      'test.com'
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('No selector');
  });
});

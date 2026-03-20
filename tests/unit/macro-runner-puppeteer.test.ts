import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MacroRunner, detectFramework } from '../../src/core/macro-runner';
import type { Macro } from '../../src/core/types';
import type { SmartSelectorResolver } from '../../src/core/smart-selector';

/**
 * Tests MacroRunner with Puppeteer-style page objects.
 * Puppeteer pages lack fill() and selectOption(), so the runner
 * must use evaluate+type for fill, select() for dropdowns, and
 * focus+keyboard.press for press actions.
 */
describe('MacroRunner — Puppeteer paths', () => {
  let mockPage: any;
  let mockResolver: any;
  let runner: MacroRunner;

  beforeEach(() => {
    // Puppeteer-style page: no fill(), no selectOption()
    mockPage = {
      click: vi.fn().mockResolvedValue(undefined),
      type: vi.fn().mockResolvedValue(undefined),
      hover: vi.fn().mockResolvedValue(undefined),
      select: vi.fn().mockResolvedValue(undefined),
      focus: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      $: vi.fn().mockResolvedValue(null),
      keyboard: {
        press: vi.fn().mockResolvedValue(undefined),
      },
    };
    mockResolver = {
      resolve: vi.fn().mockImplementation(async (_p: any, selector: string) => ({
        usedSelector: selector,
        attemptedSelectors: [selector],
        resolutionTimeMs: 1,
      })),
    };
    runner = new MacroRunner(mockResolver as SmartSelectorResolver);
  });

  it('detects Puppeteer (no fill/selectOption)', () => {
    expect(detectFramework(mockPage)).toBe('puppeteer');
  });

  it('uses evaluate + type for fill action', async () => {
    const macro: Macro = {
      id: 'pup-fill',
      domain: 'test.com',
      capabilityName: 'test',
      version: 1,
      confidence: 1,
      lastVerifiedAt: '',
      totalSteps: 1,
      steps: [{ action: 'fill', selector: '#input', paramsKey: 'val' }],
    };
    await runner.execute(mockPage, macro, { val: 'hello' });

    // Puppeteer fill: first evaluate to clear, then type
    expect(mockPage.evaluate).toHaveBeenCalled();
    expect(mockPage.type).toHaveBeenCalledWith('#input', 'hello', { delay: 10 });
  });

  it('uses select() for select action', async () => {
    const macro: Macro = {
      id: 'pup-select',
      domain: 'test.com',
      capabilityName: 'test',
      version: 1,
      confidence: 1,
      lastVerifiedAt: '',
      totalSteps: 1,
      steps: [{ action: 'select', selector: '#dropdown', paramsKey: 'opt' }],
    };
    await runner.execute(mockPage, macro, { opt: 'option-2' });

    expect(mockPage.select).toHaveBeenCalledWith('#dropdown', 'option-2');
  });

  it('uses focus + keyboard.press for press action', async () => {
    const macro: Macro = {
      id: 'pup-press',
      domain: 'test.com',
      capabilityName: 'test',
      version: 1,
      confidence: 1,
      lastVerifiedAt: '',
      totalSteps: 1,
      steps: [{ action: 'press', selector: '#search', paramsKey: 'key' }],
    };
    await runner.execute(mockPage, macro, { key: 'Enter' });

    expect(mockPage.focus).toHaveBeenCalledWith('#search');
    expect(mockPage.keyboard.press).toHaveBeenCalledWith('Enter');
  });

  it('uses evaluate for check action', async () => {
    const macro: Macro = {
      id: 'pup-check',
      domain: 'test.com',
      capabilityName: 'test',
      version: 1,
      confidence: 1,
      lastVerifiedAt: '',
      totalSteps: 1,
      steps: [{ action: 'check', selector: '#agree' }],
    };
    await runner.execute(mockPage, macro, {});

    expect(mockPage.evaluate).toHaveBeenCalled();
  });

  it('handles focus failure gracefully for press action', async () => {
    mockPage.focus = vi.fn().mockRejectedValue(new Error('Cannot focus'));

    const macro: Macro = {
      id: 'pup-press-nofocus',
      domain: 'test.com',
      capabilityName: 'test',
      version: 1,
      confidence: 1,
      lastVerifiedAt: '',
      totalSteps: 1,
      steps: [{ action: 'press', selector: '#hidden', paramsKey: 'key' }],
    };
    const result = await runner.execute(mockPage, macro, { key: 'Escape' });

    // focus failure is best-effort, keyboard.press should still fire
    expect(result.success).toBe(true);
    expect(mockPage.keyboard.press).toHaveBeenCalledWith('Escape');
  });

  it('executes a multi-step Puppeteer macro end-to-end', async () => {
    const macro: Macro = {
      id: 'pup-e2e',
      domain: 'test.com',
      capabilityName: 'login',
      version: 1,
      confidence: 0.9,
      lastVerifiedAt: '',
      totalSteps: 4,
      steps: [
        { action: 'navigate', selector: 'https://test.com/login' },
        { action: 'fill', selector: '#user', paramsKey: 'username' },
        { action: 'fill', selector: '#pass', paramsKey: 'password' },
        { action: 'click', selector: '#submit', waitForSelector: '.dashboard' },
      ],
    };
    const result = await runner.execute(mockPage, macro, {
      username: 'agent',
      password: 'secret',
    });

    expect(result.success).toBe(true);
    expect(result.stepsCompleted).toBe(4);
    expect(mockPage.goto).toHaveBeenCalledWith('https://test.com/login', expect.any(Object));
    expect(mockPage.type).toHaveBeenCalledTimes(2);
    expect(mockPage.click).toHaveBeenCalledWith('#submit', expect.any(Object));
    expect(mockPage.waitForSelector).toHaveBeenCalledWith('.dashboard', { timeout: 5000 });
  });
});

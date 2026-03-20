import type { SmartSelectorResolver } from './smart-selector';
import type { Macro, MacroStep, MacroExecutionResult, SelectorResolution, ActionType } from './types';

export interface MacroRunOptions {
  timeout?: number;                     // Total macro timeout (default: 30s)
  stepTimeout?: number;                 // Per-step timeout (default: 10s)
  onStepComplete?: (step: number, total: number) => void;  // Progress callback
  abortSignal?: AbortSignal;            // Cancellation
}

/**
 * Detect whether a page object is Playwright or Puppeteer.
 * Playwright exposes `fill()` and `selectOption()`; Puppeteer does not.
 */
export function detectFramework(page: any): 'playwright' | 'puppeteer' {
  if (typeof page.fill === 'function' && typeof page.selectOption === 'function') {
    return 'playwright';
  }
  return 'puppeteer';
}

export class MacroRunner {
  constructor(private smartSelector: SmartSelectorResolver) {}

  /**
   * Execute a full macro on a page, resolving selectors and params per step.
   */
  async execute(
    page: any,
    macro: Macro,
    params: Record<string, string>,
    options?: MacroRunOptions
  ): Promise<MacroExecutionResult> {
    const startTime = Date.now();
    const timeout = options?.timeout ?? 30000;
    const stepTimeout = options?.stepTimeout ?? 10000;

    let stepsCompleted = 0;
    let failedAtStep: number | undefined;
    let failedSelector: string | undefined;
    const selectorResolutions: SelectorResolution[] = [];

    // --- Abort signal listener ---
    let aborted = options?.abortSignal?.aborted ?? false;
    const onAbort = () => { aborted = true; };
    options?.abortSignal?.addEventListener('abort', onAbort);

    // --- Global timeout race ---
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let rejectTimeout: ((err: Error) => void) | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      rejectTimeout = reject;
      timeoutId = setTimeout(() => reject(new Error('Macro execution timeout')), timeout);
    });

    const framework = detectFramework(page);

    const executionPromise = (async (): Promise<boolean> => {
      for (let i = 0; i < macro.steps.length; i++) {
        // Check abort before every step
        if (aborted) {
          failedAtStep = i;
          throw new Error('Macro execution aborted');
        }

        const step = macro.steps[i];
        const value = step.paramsKey ? params[step.paramsKey] : undefined;

        const result = await this.executeStep(page, step, value, stepTimeout, macro.domain, framework);

        if (result.success) {
          stepsCompleted++;
          if (result.resolution) {
            selectorResolutions.push(result.resolution);
          }

          // Post-step waits
          if (step.waitMs) {
            await new Promise(r => setTimeout(r, step.waitMs));
          }
          if (step.waitForSelector) {
            try {
              await page.waitForSelector(step.waitForSelector, { timeout: 5000 });
            } catch {
              // waitForSelector timeouts are non-fatal; continue best-effort
            }
          }

          options?.onStepComplete?.(i + 1, macro.totalSteps);
        } else {
          if (step.optional) {
            // Optional step failed — do NOT increment stepsCompleted, just continue
            options?.onStepComplete?.(i + 1, macro.totalSteps);
            continue;
          }
          // Required step failed
          failedAtStep = i;
          failedSelector = step.selector;
          return false;
        }
      }
      return true;
    })();

    try {
      const success = await Promise.race([executionPromise, timeoutPromise]);
      return {
        macroId: macro.id,
        version: macro.version,
        success,
        stepsCompleted,
        totalSteps: macro.totalSteps,
        failedAtStep,
        failedSelector,
        executionTimeMs: Date.now() - startTime,
        selectorResolutions
      };
    } catch (err: any) {
      return {
        macroId: macro.id,
        version: macro.version,
        success: false,
        stepsCompleted,
        totalSteps: macro.totalSteps,
        failedAtStep: failedAtStep ?? stepsCompleted,
        failedSelector,
        executionTimeMs: Date.now() - startTime,
        selectorResolutions
      };
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      options?.abortSignal?.removeEventListener('abort', onAbort);
    }
  }

  /**
   * Execute a single macro step.
   * Public for testing — the brief spec exposes this.
   */
  async executeStep(
    page: any,
    step: MacroStep,
    value?: string,
    stepTimeout: number = 10000,
    domain: string = '',
    framework?: 'playwright' | 'puppeteer'
  ): Promise<{ success: boolean; usedSelector?: string; error?: string; resolution?: SelectorResolution }> {
    // Actions that don't need a selector
    if (!step.selector && !['wait', 'navigate'].includes(step.action)) {
      return { success: false, error: 'No selector provided for action' };
    }

    let resolution: SelectorResolution | undefined;
    let selectorsToTry: string[];

    if (step.selector) {
      // Resolve via SmartSelectorResolver (which checks the cache for better selectors)
      resolution = await this.smartSelector.resolve(page, step.selector, domain);

      // Build a de-duped ordered list: smart-resolved first, then fallbacks from the step
      const candidates = [resolution.usedSelector, ...(step.fallbackSelectors ?? [])];
      selectorsToTry = [...new Set(candidates)];
    } else {
      // For 'wait' / 'navigate' there is no selector to resolve
      selectorsToTry = [''];
    }

    const fw = framework ?? detectFramework(page);

    for (const sel of selectorsToTry) {
      try {
        await this.performAction(page, fw, step.action, sel, value, stepTimeout);

        // Track which selector actually worked if it differed from resolution
        if (resolution && sel !== resolution.usedSelector) {
          resolution = {
            ...resolution,
            usedSelector: sel,
            attemptedSelectors: [...resolution.attemptedSelectors, sel]
          };
        }

        return { success: true, usedSelector: sel, resolution };
      } catch {
        continue;
      }
    }

    return { success: false, error: 'All selectors failed for action: ' + step.action };
  }

  /**
   * Perform a single browser action. Throws on failure.
   */
  private async performAction(
    page: any,
    framework: 'playwright' | 'puppeteer',
    action: ActionType,
    selector: string,
    value: string | undefined,
    timeout: number
  ): Promise<void> {
    // --- Actions that don't use a CSS selector ---
    if (action === 'wait') {
      const ms = parseInt(value || '1000', 10);
      if (typeof page.waitForTimeout === 'function') {
        await page.waitForTimeout(ms);
      } else {
        await new Promise(r => setTimeout(r, ms));
      }
      return;
    }
    if (action === 'navigate') {
      await page.goto(selector, { timeout });
      return;
    }

    // --- Actions that require a CSS selector ---
    switch (action) {
      case 'click':
        await page.click(selector, { timeout });
        break;

      case 'fill':
        if (framework === 'playwright') {
          await page.fill(selector, value ?? '', { timeout });
        } else {
          // Puppeteer: clear field then type
          await page.evaluate(
            (sel: string) => {
              const el = document.querySelector(sel) as HTMLInputElement;
              if (el) el.value = '';
            },
            selector
          );
          await page.type(selector, value ?? '', { delay: 10 });
        }
        break;

      case 'type':
        await page.type(selector, value ?? '', { delay: 50 });
        break;

      case 'select':
        if (framework === 'playwright') {
          await page.selectOption(selector, value ?? '', { timeout });
        } else {
          await page.select(selector, value ?? '');
        }
        break;

      case 'hover':
        await page.hover(selector);
        break;

      case 'press':
        if (framework === 'playwright') {
          await page.press(selector || 'body', value ?? 'Enter', { timeout });
        } else {
          try { await page.focus(selector); } catch { /* focus is best-effort */ }
          await page.keyboard.press(value ?? 'Enter');
        }
        break;

      case 'scroll':
        await page.evaluate(
          (sel: string) =>
            document.querySelector(sel)?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
          selector
        );
        break;

      case 'check':
        if (framework === 'playwright') {
          await page.check(selector, { timeout });
        } else {
          await page.evaluate(
            (sel: string) => {
              const el = document.querySelector(sel) as HTMLInputElement;
              if (el) el.checked = true;
            },
            selector
          );
        }
        break;

      case 'evaluate':
      case 'screenshot':
        // No-op in the runner — these are informational action types
        break;
    }
  }
}

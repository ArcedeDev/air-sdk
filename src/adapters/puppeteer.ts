import type { AIRConfig, BrowserInfo } from '../core/types';
import { AbstractPageAdapter } from './base-adapter';
import { CapabilityExecutor } from '../execute/executor';

/** Methods on a Puppeteer Page that represent observable browser actions. */
const PUPPETEER_ACTION_METHODS = [
  'click',
  'type', 'press',
  'select', 'tap', 'hover', 'focus',
  'waitForSelector', 'waitForNavigation',
  'screenshot',
  'evaluate', 'evaluateHandle',
];

/**
 * PuppeteerAdapter — Concrete adapter for Puppeteer's Page API.
 *
 * Key differences from Playwright:
 * - `type` instead of `fill`
 * - `select` instead of `selectOption`
 * - No `check`/`uncheck` methods
 * - `viewport()` is a method, not `viewportSize()`
 */
class PuppeteerAdapter extends AbstractPageAdapter {
  getActionMethods(): string[] {
    return PUPPETEER_ACTION_METHODS;
  }

  extractBrowserInfo(page: any): BrowserInfo {
    if (!page) {
      return { framework: 'puppeteer', frameworkVersion: 'unknown', headless: true };
    }

    let headless = true;
    try {
      headless = !(page.browser?.()?.isConnected?.());
    } catch {
      // Default to headless
    }

    let viewport: { width: number; height: number } | undefined;
    try {
      const vp = page.viewport?.();
      if (vp) viewport = { width: vp.width, height: vp.height };
    } catch {
      // viewport detection is best-effort
    }

    return {
      framework: 'puppeteer',
      frameworkVersion: 'unknown',
      headless,
      viewport,
    };
  }

  wrapPage(page: any): any {
    return createAIRProxy(page, this);
  }
}

/**
 * Build a JavaScript Proxy around the Puppeteer page — same pattern as
 * the Playwright adapter, adjusted for Puppeteer API conventions.
 */
function createAIRProxy(page: any, adapter: PuppeteerAdapter): any {
  return new Proxy(page, {
    get(target: any, prop: string | symbol, receiver: any): any {
      if (typeof prop !== 'string') {
        return Reflect.get(target, prop, receiver);
      }

      // --- .air accessor ---
      if (prop === 'air') {
        return adapter.getExecutor();
      }

      // --- .destroy() ---
      if (prop === 'destroy') {
        return () => adapter.destroy();
      }

      // --- goto: navigation tracking + action recording ---
      if (prop === 'goto') {
        const original = target.goto.bind(target);
        return async (...args: any[]) => {
          const url = args[0];
          if (url != null) {
            await adapter.getObserver().onNavigate(String(url));
          }
          return adapter.getObserver().wrapMethod('goto', original, target)(...args);
        };
      }

      // --- close: flush before teardown ---
      if (prop === 'close') {
        const original = target.close.bind(target);
        return async (...args: any[]) => {
          await adapter.getObserver().flush();
          return original(...args);
        };
      }

      // --- Action methods ---
      if (adapter.isActionMethod(prop)) {
        const original = target[prop];
        if (typeof original === 'function') {
          return adapter.getObserver().wrapMethod(prop, original.bind(target), target);
        }
      }

      // --- Pass-through ---
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    },
  });
}

/**
 * Wrap a Puppeteer Page with AIR execution intelligence.
 * The returned page is 100% API-compatible — all existing code works unchanged.
 *
 * @example
 * ```ts
 * import { withAIR } from '@arcede/air-sdk/puppeteer';
 * const smartPage = withAIR(page, { apiKey: 'air_xxx' });
 * await smartPage.goto('https://example.com');
 * ```
 */
export function withAIR<T = any>(page: T, config: AIRConfig): T & { air: CapabilityExecutor; destroy: () => Promise<void> } {
  const adapter = new PuppeteerAdapter(config);
  return adapter.wrapPage(page);
}

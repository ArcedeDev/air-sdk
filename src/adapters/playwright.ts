import type { AIRConfig, BrowserInfo } from '../core/types';
import { AbstractPageAdapter } from './base-adapter';
import { CapabilityExecutor } from '../execute/executor';

/** Methods on a Playwright Page that represent observable browser actions. */
const PLAYWRIGHT_ACTION_METHODS = [
  'click', 'dblclick',
  'fill', 'type', 'press',
  'selectOption', 'check', 'uncheck',
  'hover', 'focus', 'tap',
  'waitForSelector', 'waitForURL', 'waitForLoadState',
  'screenshot',
  'evaluate', 'evaluateHandle',
  'scrollIntoViewIfNeeded',
];

/**
 * PlaywrightAdapter — Concrete adapter for Playwright's Page API.
 *
 * Extracts Playwright-specific browser metadata and knows which
 * Playwright methods constitute observable browser actions.
 */
class PlaywrightAdapter extends AbstractPageAdapter {
  getActionMethods(): string[] {
    return PLAYWRIGHT_ACTION_METHODS;
  }

  extractBrowserInfo(page: any): BrowserInfo {
    if (!page) {
      return { framework: 'playwright', frameworkVersion: 'unknown', headless: true };
    }

    let headless = true;
    try {
      headless = !(page.context?.()?.browser?.()?.isConnected?.());
    } catch {
      // Default to headless if we can't determine
    }

    let viewport: { width: number; height: number } | undefined;
    try {
      viewport = page.viewportSize?.() ?? undefined;
    } catch {
      // Viewport detection is best-effort
    }

    return {
      framework: 'playwright',
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
 * Build a JavaScript Proxy around the Playwright page that:
 * 1. Intercepts action methods → records via ActionObserver
 * 2. Intercepts `goto` → also triggers domain preload via onNavigate
 * 3. Intercepts `close` → flushes observer on page teardown
 * 4. Exposes `.air` → the CapabilityExecutor for high-level execute()
 * 5. Everything else → transparent pass-through to the real page
 */
function createAIRProxy(page: any, adapter: PlaywrightAdapter): any {
  return new Proxy(page, {
    get(target: any, prop: string | symbol, receiver: any): any {
      if (typeof prop !== 'string') {
        return Reflect.get(target, prop, receiver);
      }

      // --- .air accessor: expose the CapabilityExecutor ---
      if (prop === 'air') {
        return adapter.getExecutor();
      }

      // --- .destroy(): explicit SDK cleanup ---
      if (prop === 'destroy') {
        return () => adapter.destroy();
      }

      // --- goto: navigation tracking + action interception ---
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

      // --- close: flush observer before the page closes ---
      if (prop === 'close') {
        const original = target.close.bind(target);
        return async (...args: any[]) => {
          await adapter.getObserver().flush();
          return original(...args);
        };
      }

      // --- Action methods: intercept and record ---
      if (adapter.isActionMethod(prop)) {
        const original = target[prop];
        if (typeof original === 'function') {
          return adapter.getObserver().wrapMethod(prop, original.bind(target), target);
        }
      }

      // --- Everything else: transparent pass-through ---
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    },
  });
}

/**
 * Wrap a Playwright Page with AIR execution intelligence.
 * The returned page is 100% API-compatible — all existing code works unchanged.
 *
 * @example
 * ```ts
 * import { withAIR } from '@arcede/air-sdk/playwright';
 * const smartPage = withAIR(page, { apiKey: 'air_xxx' });
 * await smartPage.goto('https://kayak.com/flights');  // observed + enhanced
 * const result = await smartPage.air.execute(smartPage, {
 *   capability: 'search_flights',
 *   domain: 'kayak.com',
 *   params: { destination: 'Tokyo' }
 * });
 * ```
 */
export function withAIR<T = any>(page: T, config: AIRConfig): T & { air: CapabilityExecutor; destroy: () => Promise<void> } {
  const adapter = new PlaywrightAdapter(config);
  return adapter.wrapPage(page);
}

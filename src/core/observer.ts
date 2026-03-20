import { ActionType, BrowserInfo, RecordedAction, TelemetryEvent } from './types';
import { PrivacyFilter } from './privacy-filter';

export interface MinimalCapabilityCache {
  preload(domain: string): Promise<unknown>;
}

export class ActionObserver {
  private actions: RecordedAction[] = [];
  private currentDomain: string | null = null;
  private capabilityCache: MinimalCapabilityCache;
  private privacyFilter: PrivacyFilter;
  private onFlush: (event: TelemetryEvent) => void;
  private browserInfo: BrowserInfo;

  constructor(options: {
    capabilityCache: MinimalCapabilityCache;
    privacyFilter: PrivacyFilter;
    browserInfo: BrowserInfo;
    onFlush: (event: TelemetryEvent) => void;
  }) {
    this.capabilityCache = options.capabilityCache;
    this.privacyFilter = options.privacyFilter;
    this.browserInfo = options.browserInfo;
    this.onFlush = options.onFlush;
  }

  // Core method: wraps a page method to record the action transparently
  wrapMethod(methodName: string, originalMethod: Function, page: any): Function {
    return async (...args: any[]) => {
      const startTime = Date.now();
      let success = true;
      let error: any;
      let result: any;

      try {
        result = await originalMethod.apply(page, args);
        return result;
      } catch (e) {
        success = false;
        error = e;
        throw e;
      } finally {
        const actionType = methodNameToActionType(methodName);
        const selector = extractSelector(methodName, args);

        const url = actionType === 'navigate' ? (args[0] != null ? String(args[0]) : undefined) : undefined;
        let key: string | undefined;
        if (actionType === 'press' && args.length > 1) {
          key = args[1] != null ? String(args[1]) : undefined;
        }

        // Record immediately — no async work in finally, so error propagation is never delayed
        const action: RecordedAction = {
          type: actionType,
          selector,
          value: '[REDACTED]', // NEVER record actual values
          url,
          key,
          success,
          durationMs: Date.now() - startTime,
          timestamp: Date.now(),
        };
        this.recordAction(action);

        // Fire-and-forget: enrich with DOM context after recording.
        // The action is stored by reference in this.actions, so the mutation
        // lands before flush() runs (which only happens on domain change).
        if (selector && page && typeof page.evaluate === 'function') {
          this.captureDOMContext(page, selector)
            .then((ctx) => { if (ctx) action.domContext = ctx; })
            .catch(() => {}); // silently ignore — element may be gone
        }
      }
    };
  }

  // Captures lightweight structural context via page.evaluate
  private async captureDOMContext(page: any, selector: string) {
    return await page.evaluate((sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return undefined;
      let siblingCount = 0;
      if (el.parentElement) {
        siblingCount = el.parentElement.children.length - 1;
      }
      return {
        tagName: el.tagName,
        role: el.getAttribute('role') || undefined,
        ariaLabel: el.getAttribute('aria-label') || undefined,
        dataTestId: el.getAttribute('data-testid') || undefined,
        parentTag: el.parentElement?.tagName,
        siblingCount,
        formParent: !!el.closest('form')
      };
    }, selector);
  }

  private recordAction(action: RecordedAction) {
    this.actions.push(action);
  }

  /**
   * Public method for external callers (e.g. Browser Use plugin) to record
   * an action directly, bypassing the wrapMethod interception pattern.
   */
  record(action: RecordedAction): void {
    this.recordAction(action);
  }

  async onNavigate(url: string): Promise<void> {
    try {
      const domain = new URL(url).hostname;
      if (domain !== this.currentDomain) {
        if (this.currentDomain && this.actions.length > 0) {
          await this.flush(); // Flush actions for previous domain
        }
        this.currentDomain = domain;
        this.actions = [];
        await this.capabilityCache.preload(domain); // preload new domain
      }
    } catch {
      // invalid URL
    }
  }

  async flush(): Promise<void> {
    if (this.actions.length === 0 || !this.currentDomain) return;

    // Package all buffered actions into a TelemetryEvent
    const event: Partial<TelemetryEvent> = {
      domain: this.currentDomain,
      actionSequence: this.actions as any, // Will be casted back by PrivacyFilter
      sessionOutcome: inferOutcome(this.actions),
      browserInfo: this.browserInfo,
      executionTimeMs: this.actions.reduce((acc, a) => acc + a.durationMs, 0),
      timestamp: new Date().toISOString()
    };

    // Strip out all PII
    const filteredEvent = this.privacyFilter.filterEvent(event);
    this.onFlush(filteredEvent);
    this.actions = [];
  }

  get actionCount(): number {
    return this.actions.length;
  }

  get domain(): string | null {
    return this.currentDomain;
  }
}

export function methodNameToActionType(methodName: string): ActionType {
  const map: Record<string, ActionType> = {
    click: 'click',
    dblclick: 'click',
    fill: 'fill',
    type: 'type',
    goto: 'navigate',
    navigate: 'navigate',
    selectOption: 'select',
    select: 'select',
    check: 'check',
    uncheck: 'check',
    hover: 'hover',
    press: 'press',
    'keyboard.press': 'press',
    scroll: 'scroll',
    waitForSelector: 'wait',
    waitForTimeout: 'wait',
    screenshot: 'screenshot',
    evaluate: 'evaluate',
    evaluateHandle: 'evaluate'
  };
  return map[methodName] || 'evaluate';
}

export function extractSelector(methodName: string, args: any[]): string | undefined {
  if (['click', 'dblclick', 'fill', 'type', 'selectOption', 'select', 'check', 'uncheck', 'hover', 'waitForSelector', 'scroll'].includes(methodName)) {
    return typeof args[0] === 'string' ? args[0] : undefined;
  }
  if (methodName === 'press' || methodName === 'keyboard.press') {
    if (args.length === 2) return String(args[0]);
    return undefined; // If only 1 arg it is likely keyboard.press(key) not press(selector, key)
  }
  return undefined;
}

export function inferOutcome(actions: RecordedAction[]): 'success' | 'failure' | 'partial' | 'unknown' {
  if (!actions || actions.length === 0) return 'unknown';
  const allSuccess = actions.every(a => a.success);
  if (allSuccess) return 'success';
  const lastFailed = !actions[actions.length - 1].success;
  if (lastFailed) return 'failure';
  return 'partial';
}

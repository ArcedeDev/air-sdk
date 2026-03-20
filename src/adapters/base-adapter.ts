import type { AIRConfig, ResolvedAIRConfig, BrowserInfo, TelemetryEvent } from '../core/types';
import { resolveConfig, validateConfig } from '../core/config';
import { AIRHttpClient } from '../core/http';
import { CapabilityCache } from '../core/capability-cache';
import { SmartSelectorResolver } from '../core/smart-selector';
import { PrivacyFilter } from '../core/privacy-filter';
import { ActionObserver } from '../core/observer';
import { TelemetryReporter } from '../core/telemetry';
import { MacroRunner } from '../core/macro-runner';
import { CapabilityExecutor } from '../execute/executor';

/** All the wired-up SDK internals, returned by createSDKComponents(). */
export interface SDKComponents {
  config: ResolvedAIRConfig;
  httpClient: AIRHttpClient;
  cache: CapabilityCache;
  smartSelector: SmartSelectorResolver;
  privacyFilter: PrivacyFilter;
  observer: ActionObserver;
  telemetry: TelemetryReporter;
  macroRunner: MacroRunner;
  executor: CapabilityExecutor;
}

/**
 * Wire up all SDK internal components from a user config and browser info.
 * Shared by AbstractPageAdapter and standalone plugins (e.g., Browser Use).
 */
export function createSDKComponents(config: AIRConfig, browserInfo: BrowserInfo): SDKComponents {
  validateConfig(config);
  const resolved = resolveConfig(config);

  const httpClient = new AIRHttpClient(resolved);
  const cache = new CapabilityCache(resolved, httpClient);
  const smartSelector = new SmartSelectorResolver(cache);
  const privacyFilter = new PrivacyFilter();
  const telemetry = new TelemetryReporter(resolved, httpClient);

  const observer = new ActionObserver({
    capabilityCache: cache,
    privacyFilter,
    browserInfo,
    onFlush: (event: TelemetryEvent) => telemetry.enqueue(event),
  });

  const macroRunner = new MacroRunner(smartSelector);

  const executor = new CapabilityExecutor({
    cache,
    macroRunner,
    telemetry,
    httpClient,
  });

  return { config: resolved, httpClient, cache, smartSelector, privacyFilter, observer, telemetry, macroRunner, executor };
}

/**
 * AbstractPageAdapter — Framework-agnostic base class that wires together
 * all SDK internal systems (observer, cache, telemetry, executor).
 *
 * Concrete adapters (Playwright, Puppeteer) extend this and implement
 * the framework-specific page wrapping logic.
 */
export abstract class AbstractPageAdapter {
  protected config: ResolvedAIRConfig;
  protected httpClient: AIRHttpClient;
  protected cache: CapabilityCache;
  protected smartSelector: SmartSelectorResolver;
  protected privacyFilter: PrivacyFilter;
  protected observer: ActionObserver;
  protected telemetry: TelemetryReporter;
  protected macroRunner: MacroRunner;
  protected executor: CapabilityExecutor;

  private _destroyed = false;
  private _exitHandler: (() => void) | null = null;
  private _actionMethodSet: Set<string> | null = null;

  constructor(config: AIRConfig) {
    const sdk = createSDKComponents(config, this.extractBrowserInfo(null));

    this.config = sdk.config;
    this.httpClient = sdk.httpClient;
    this.cache = sdk.cache;
    this.smartSelector = sdk.smartSelector;
    this.privacyFilter = sdk.privacyFilter;
    this.observer = sdk.observer;
    this.telemetry = sdk.telemetry;
    this.macroRunner = sdk.macroRunner;
    this.executor = sdk.executor;

    this._registerProcessExitHandler();
  }

  /** Returns the list of method names to intercept for the specific framework. */
  abstract getActionMethods(): string[];

  /** Extracts framework-specific browser metadata for telemetry. */
  abstract extractBrowserInfo(page: any): BrowserInfo;

  /** Wraps a framework page object with the AIR Proxy. */
  abstract wrapPage(page: any): any;

  /** Whether a given method name is an action that should be observed. */
  isActionMethod(name: string): boolean {
    // Cache the Set on first call for O(1) lookups
    if (!this._actionMethodSet) {
      this._actionMethodSet = new Set(this.getActionMethods());
    }
    return this._actionMethodSet.has(name);
  }

  /** Public accessor for the observer — needed by Proxy functions in adapter modules. */
  getObserver(): ActionObserver {
    return this.observer;
  }

  /** Public accessor for the executor — needed by Proxy functions in adapter modules. */
  getExecutor(): CapabilityExecutor {
    return this.executor;
  }

  /**
   * Cleanly shut down the adapter:
   *  - Flush remaining observer actions
   *  - Shut down telemetry (flush + stop timer)
   *  - Clear the cache
   *  - Remove process exit handler
   */
  async destroy(): Promise<void> {
    if (this._destroyed) return;
    this._destroyed = true;

    try {
      await this.observer.flush();
    } catch {
      // Best-effort flush
    }

    try {
      await this.telemetry.shutdown();
    } catch {
      // Best-effort shutdown
    }

    this.cache.clear();

    if (this._exitHandler) {
      process.removeListener('beforeExit', this._exitHandler);
      this._exitHandler = null;
    }
  }

  /** Register an auto-flush handler so telemetry is never lost on exit. */
  private _registerProcessExitHandler(): void {
    if (typeof process !== 'undefined' && typeof process.on === 'function') {
      this._exitHandler = () => {
        if (!this._destroyed) {
          // Best-effort synchronous-ish shutdown — Node will wait for this
          this.destroy().catch(() => {});
        }
      };
      // Bump the listener limit to avoid MaxListenersExceededWarning when
      // multiple adapters exist (common in tests and multi-page scenarios)
      const current = process.getMaxListeners();
      if (current <= 20) {
        process.setMaxListeners(current + 1);
      }
      process.on('beforeExit', this._exitHandler);
    }
  }
}

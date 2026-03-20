import type { AIRConfig, BrowserInfo, RecordedAction } from '../core/types';
import { createSDKComponents, type SDKComponents } from './base-adapter';
import { CapabilityExecutor } from '../execute/executor';

/**
 * Represents a Browser Use action event passed via the plugin lifecycle.
 * The exact shape may evolve as Browser Use's API matures.
 */
export interface BrowserUseAction {
  type: string;
  selector?: string;
  value?: string;
  url?: string;
  success?: boolean;
  durationMs?: number;
  [key: string]: unknown;
}

/**
 * AIRPlugin for the Browser Use agent framework.
 *
 * Browser Use uses a plugin architecture instead of page wrapping.
 * The plugin receives lifecycle callbacks:
 * - `onStart(page)` — Agent task begins, initialize observation
 * - `onAction(action)` — Each browser action, record it
 * - `onEnd(result)` — Agent task ends, flush and shut down
 *
 * @example
 * ```ts
 * import { AIRPlugin } from '@arcede/air-sdk/browser-use';
 * const plugin = new AIRPlugin({ apiKey: 'air_xxx' });
 * const agent = Agent({ plugins: [plugin] });
 * ```
 */
export class AIRPlugin {
  readonly name = 'air-sdk';

  private sdk: SDKComponents;
  private _destroyed = false;

  constructor(config: AIRConfig) {
    const browserInfo: BrowserInfo = {
      framework: 'browser-use',
      frameworkVersion: 'unknown',
      headless: true,
    };
    this.sdk = createSDKComponents(config, browserInfo);
  }

  /** Access the CapabilityExecutor for high-level capability execution. */
  get air(): CapabilityExecutor {
    return this.sdk.executor;
  }

  /**
   * Called by Browser Use when an agent task starts.
   * Initializes the observer and preloads capabilities for the current domain.
   */
  async onStart(page: any): Promise<void> {
    // Try to determine the initial domain from the page URL
    try {
      const url = typeof page.url === 'function' ? page.url() : page.url;
      if (url) {
        await this.sdk.observer.onNavigate(String(url));
      }
    } catch {
      // Page may not have a URL yet — that's fine
    }
  }

  /**
   * Called by Browser Use on each browser action the agent performs.
   * Maps the Browser Use action format into our RecordedAction schema.
   */
  async onAction(action: BrowserUseAction): Promise<void> {
    if (this._destroyed) return;

    // Map Browser Use action into our recording schema
    const recordedAction: RecordedAction = {
      type: mapBrowserUseActionType(action.type),
      selector: action.selector,
      value: '[REDACTED]', // Never record actual values
      url: action.url,
      success: action.success ?? true,
      durationMs: action.durationMs ?? 0,
      timestamp: Date.now(),
    };

    // If this is a navigation action, update domain tracking
    if (action.url && (action.type === 'goto' || action.type === 'navigate')) {
      await this.sdk.observer.onNavigate(action.url);
    }

    // Record the action via the observer's public API
    this.sdk.observer.record(recordedAction);
  }

  /**
   * Called by Browser Use when the agent task ends.
   * Flushes all remaining telemetry before the process exits.
   */
  async onEnd(_result?: any): Promise<void> {
    if (this._destroyed) return;
    this._destroyed = true;

    try {
      await this.sdk.observer.flush();
    } catch {
      // Best-effort
    }

    try {
      await this.sdk.telemetry.shutdown();
    } catch {
      // Best-effort
    }
  }
}

/**
 * Map Browser Use action type strings to our ActionType union.
 * Falls back to 'evaluate' for unknown action types.
 */
function mapBrowserUseActionType(type: string): RecordedAction['type'] {
  const mapping: Record<string, RecordedAction['type']> = {
    click: 'click',
    type: 'type',
    fill: 'fill',
    goto: 'navigate',
    navigate: 'navigate',
    select: 'select',
    check: 'check',
    hover: 'hover',
    press: 'press',
    scroll: 'scroll',
    wait: 'wait',
    screenshot: 'screenshot',
    evaluate: 'evaluate',
  };
  return mapping[type] ?? 'evaluate';
}

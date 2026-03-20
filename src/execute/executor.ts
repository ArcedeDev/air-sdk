import type { CapabilityCache } from '../core/capability-cache';
import type { MacroRunner } from '../core/macro-runner';
import type { TelemetryReporter } from '../core/telemetry';
import type { AIRHttpClient } from '../core/http';
import type { Capability, ExecuteOptions, ExecuteResult, FeedbackPayload } from '../core/types';
import { FallbackObserver } from './fallback-observer';

export class CapabilityExecutor {
  private fallbackObserver: FallbackObserver;
  private cache: CapabilityCache;
  private macroRunner: MacroRunner;
  private telemetry: TelemetryReporter;
  private httpClient: AIRHttpClient;

  constructor(options: {
    cache: CapabilityCache;
    macroRunner: MacroRunner;
    telemetry: TelemetryReporter;
    httpClient: AIRHttpClient;
  }) {
    this.cache = options.cache;
    this.macroRunner = options.macroRunner;
    this.telemetry = options.telemetry;
    this.httpClient = options.httpClient;
    this.fallbackObserver = new FallbackObserver();
  }

  /**
   * High-level execute: find capability → download macro → run → report feedback.
   */
  async execute(
    page: any,
    options: ExecuteOptions
  ): Promise<ExecuteResult> {
    const startTime = Date.now();

    // 1. Fetch capabilities for domain
    const capabilities = await this.cache.getCapabilities(options.domain);
    const capability = capabilities.find(c => c.name === options.capability);

    if (!capability) {
      return {
        success: false,
        macroUsed: false,
        executionTimeMs: Date.now() - startTime,
        fallbackUsed: false,
        error: 'capability_not_found'
      };
    }

    // 2. Check macro availability
    if (!capability.macroAvailable || !capability.macroId) {
      return {
        success: false,
        macroUsed: false,
        executionTimeMs: Date.now() - startTime,
        fallbackUsed: false,
        error: 'no_macro_available'
      };
    }

    // 3. Download macro
    const macro = await this.cache.getMacro(capability.macroId);
    if (!macro) {
      return {
        success: false,
        macroUsed: false,
        executionTimeMs: Date.now() - startTime,
        fallbackUsed: false,
        error: 'macro_download_failed'
      };
    }

    // 4. Execute macro
    const result = await this.macroRunner.execute(page, macro, options.params, {
      timeout: options.timeout,
      onStepComplete: options.onProgress,
      abortSignal: options.abortSignal
    });

    // 5. Report feedback
    if (result.success) {
      await this.sendFeedback({
        macroId: macro.id,
        macroVersion: macro.version,
        success: true
      });

      return {
        success: true,
        macroUsed: true,
        macroId: macro.id,
        macroVersion: macro.version,
        stepsCompleted: result.stepsCompleted,
        totalSteps: result.totalSteps,
        executionTimeMs: Date.now() - startTime,
        fallbackUsed: false
      };
    }

    // 6. Macro failed — start fallback observation and report failure
    this.fallbackObserver.startObserving(page, macro.id, result.failedAtStep ?? 0);

    await this.sendFeedback({
      macroId: macro.id,
      macroVersion: macro.version,
      success: false,
      failedAtStep: result.failedAtStep,
      failedSelector: result.failedSelector,
      errorType: 'selector_not_found'
    });

    return {
      success: false,
      macroUsed: true,
      macroId: macro.id,
      macroVersion: macro.version,
      stepsCompleted: result.stepsCompleted,
      totalSteps: result.totalSteps,
      executionTimeMs: Date.now() - startTime,
      fallbackUsed: true,
      error: 'macro_execution_failed'
    };
  }

  /** List available capabilities for a domain (cache-first). */
  async listCapabilities(domain: string): Promise<Capability[]> {
    return this.cache.getCapabilities(domain);
  }

  /** Search capabilities across domains via the cloud search endpoint. */
  async searchCapabilities(query: string): Promise<Capability[]> {
    try {
      const response = await this.httpClient.get<{ capabilities: Capability[] }>(
        '/api/v1/sdk/capabilities',
        { search: query }
      );
      return response.capabilities ?? [];
    } catch {
      return [];
    }
  }

  /** Get the fallback observer (for adapters / integration layers) */
  getFallbackObserver(): FallbackObserver {
    return this.fallbackObserver;
  }

  /**
   * Send macro execution feedback to the cloud.
   * Swallows errors — feedback is best-effort, never crashes the developer's flow.
   */
  private async sendFeedback(payload: FeedbackPayload): Promise<void> {
    try {
      await this.httpClient.post('/api/v1/sdk/feedback', payload);
    } catch {
      // Swallow — feedback is fire-and-forget
    }
  }
}

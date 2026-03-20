// ============================================================
// AIR SDK — Public API
// ============================================================

// Core types — re-exported for consumers
export type {
  // Configuration
  AIRConfig,
  ResolvedAIRConfig,

  // MPP
  MPPConfig,
  MPPChallenge,
  MPPCredential,
  SpendingPolicy,
  SpendingLedger,
  PaymentEvent,

  // Actions
  ActionType,
  RecordedAction,
  DOMContext,

  // Selectors
  SmartSelector,
  SelectorResolution,

  // Macros
  Macro,
  MacroStep,
  MacroExecutionResult,

  // Capabilities
  Capability,
  CapabilityParameter,
  CapabilityPricing,

  // Telemetry
  TelemetryPayload,
  TelemetryEvent,
  TelemetryAction,
  BrowserInfo,
  PageSignals,

  // Feedback
  FeedbackPayload,

  // API Responses
  CapabilitiesResponse,
  MacroResponse,
  TelemetryResponse,
  AIRErrorCode,

  // Execute
  ExecuteOptions,
  ExecuteResult,

  // Adapters
  SupportedFramework,
} from './core/types';

// AIRError class (value export — usable with instanceof)
export { AIRError } from './core/types';

// Config utilities
export {
  resolveConfig,
  validateConfig,
  extractApiKeyPrefix,
  DEFAULT_BASE_URL,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_TELEMETRY_BATCH_SIZE,
  DEFAULT_TELEMETRY_FLUSH_INTERVAL_MS,
} from './core/config';

// Core modules — re-exported for adapters and downstream consumers
export { ActionObserver, methodNameToActionType, extractSelector, inferOutcome } from './core/observer';
export { TelemetryReporter } from './core/telemetry';
export { CapabilityCache } from './core/capability-cache';
export { SmartSelectorResolver } from './core/smart-selector';
export { PrivacyFilter } from './core/privacy-filter';
export { AIRHttpClient, HttpError } from './core/http';
export { MacroRunner, detectFramework } from './core/macro-runner';
export type { MacroRunOptions } from './core/macro-runner';
export { CapabilityExecutor } from './execute/executor';
export { FallbackObserver } from './execute/fallback-observer';
export { MPPHandler } from './core/mpp-handler';
export { SpendingPolicyManager } from './core/spending-policy';
export { SDK_VERSION } from './version';

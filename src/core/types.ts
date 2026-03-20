// ============================================================
// AIR SDK — Core Type Definitions
// All cloud endpoints accept/return these types.
// Conventions: interfaces over type aliases, union strings
// over enums, camelCase for TS, snake_case in DB comments.
// ============================================================

// ============================================================
// Configuration
// ============================================================

/** SDK initialization config passed to withAIR() or new AIR() */
export interface AIRConfig {
  /** API key starting with "air_" (e.g., "air_sdk_live_abc123...") */
  apiKey: string;
  /** Cloud API base URL */
  baseURL?: string;
  /** Send execution telemetry to AIR cloud */
  telemetryEnabled?: boolean;
  /** Cache capabilities and macros locally */
  cacheEnabled?: boolean;
  /** Local cache time-to-live in milliseconds */
  cacheTTLMs?: number;
  /** Max telemetry events before auto-flush */
  telemetryBatchSize?: number;
  /** Telemetry flush interval in milliseconds */
  telemetryFlushIntervalMs?: number;
  /** Log debug info to console */
  debug?: boolean;
  /** Callback for non-fatal SDK errors (network, cache, etc.) */
  onError?: (error: AIRError) => void;
  /** Machine Payments Protocol configuration */
  mpp?: MPPConfig;
  /** Include rich execution intelligence fields in capability responses */
  includeExecution?: boolean;
}

/** Fully resolved config with all defaults applied */
export interface ResolvedAIRConfig {
  apiKey: string;
  baseURL: string;
  telemetryEnabled: boolean;
  cacheEnabled: boolean;
  cacheTTLMs: number;
  telemetryBatchSize: number;
  telemetryFlushIntervalMs: number;
  debug: boolean;
  onError?: (error: AIRError) => void;
  mpp?: MPPConfig;
  includeExecution?: boolean;
}

// ============================================================
// MPP (Machine Payments Protocol)
// ============================================================

/** Configuration for transparent agent payments */
export interface MPPConfig {
  /** Enable HTTP 402 detection and auto-payment */
  enabled: boolean;
  /** Payment method to use */
  paymentMethod: 'stripe_spt' | 'crypto_wallet';
  /** Stripe Shared Payment Token or wallet address */
  credential: string;
  /** USD cap per single payment */
  maxPerRequest: number;
  /** USD cap per browsing session */
  maxPerSession: number;
  /** Auto-pay within limits without callback */
  autoApprove: boolean;
  /** Custom approval logic for payments exceeding auto-approve threshold */
  onPaymentRequired?: (challenge: MPPChallenge) => Promise<boolean>;
}

/** Parsed from an HTTP 402 response body */
export interface MPPChallenge {
  /** Unique challenge identifier from the server */
  challengeId: string;
  /** Payment amount */
  amount: number;
  /** Currency code */
  currency: string;
  /** Recipient account (Stripe account ID or crypto address) */
  recipient: string;
  /** Accepted payment methods */
  paymentMethods: string[];
  /** Domain that issued the challenge */
  domain: string;
  /** Original URL that returned 402 */
  resourceUrl: string;
}

/** Authorization credential for MPP retry */
export interface MPPCredential {
  /** Auth scheme ("MPP" or "Bearer") */
  scheme: string;
  /** Credential token for the Authorization header */
  token: string;
  /** Expiry as Unix timestamp (ms) */
  expiresAt: number;
}

/** Per-request and per-session payment limits */
export interface SpendingPolicy {
  maxPerRequest: number;
  maxPerSession: number;
  /** Auto-approve amounts below this threshold */
  autoApproveBelow: number;
  /** Domains that always require manual approval */
  requireApprovalDomains: string[];
}

/** Running payment totals for the current session */
export interface SpendingLedger {
  /** Total USD spent this session */
  sessionTotal: number;
  /** Number of payments made this session */
  requestCount: number;
  /** Per-domain running totals */
  domainTotals: Record<string, number>;
}

/** Telemetry record of a payment */
export interface PaymentEvent {
  amountUsd: number;
  currency: string;
  protocol: 'mpp';
  domain: string;
  challengeId: string;
  success: boolean;
  /** If payment was for a known capability */
  capabilityName?: string;
}

// ============================================================
// 402 Index Integration (Brief 11)
// ============================================================

/** A paid API service from 402index.io */
export interface IndexService {
  id: string;
  name: string;
  url: string;
  protocol: 'L402' | 'x402' | 'MPP';
  price_usd: number | null;
  price_sats: number | null;
  reliability_score: number | null;
  latency_p50_ms: number | null;
  health_status: 'healthy' | 'degraded' | 'down' | 'unknown' | null;
  category: string | null;
  provider: string | null;
}

/** An execution route option produced by the RouteOptimizer */
export interface RouteOption {
  /** How the agent would fulfill the request */
  method: 'pay_challenge' | 'paid_api' | 'air_macro';
  /** Estimated cost in USD */
  costUsd: number;
  /** Estimated latency in milliseconds */
  latencyEstMs: number;
  /** Reliability score 0–1 */
  reliability: number;
  /** Where this option came from */
  source: 'original' | '402index' | 'air_capabilities';
  /** Endpoint URL (for paid_api alternatives) */
  url?: string;
  /** Macro ID (for air_macro alternatives) */
  macroId?: string;
  /** Payment protocol */
  protocol?: string;
  /** Provider name */
  provider?: string;
}

/** Extended return type for handlePaymentRequired when auto-routing is active */
export interface PaymentHandlerResult {
  paid: boolean;
  credential?: MPPCredential;
  paymentEvent?: PaymentEvent;
  /** When a cheaper alternative is found, these are returned instead of paying */
  alternatives?: RouteOption[];
  /** The optimizer's top recommendation */
  recommendedAction?: RouteOption;
}

// ============================================================
// Action Recording
// ============================================================

/** Browser action types the SDK can observe and record */
export type ActionType =
  | 'navigate'
  | 'click'
  | 'fill'
  | 'type'
  | 'select'
  | 'check'
  | 'scroll'
  | 'hover'
  | 'press'
  | 'wait'
  | 'screenshot'
  | 'evaluate';

/** A single recorded browser interaction */
export interface RecordedAction {
  type: ActionType;
  /** CSS selector used for the action */
  selector?: string;
  /** Alternative selectors discovered during resolution */
  fallbackSelectors?: string[];
  /** Always "[REDACTED]" — actual values never recorded */
  value?: string;
  /** For navigate actions */
  url?: string;
  /** For press/keyboard actions */
  key?: string;
  /** Whether the action succeeded */
  success: boolean;
  /** Time taken in milliseconds */
  durationMs: number;
  /** When the action occurred */
  timestamp: number;
  /** Anonymized DOM context around the target element */
  domContext?: DOMContext;
}

/** Anonymized DOM structure around an interacted element */
export interface DOMContext {
  tagName: string;
  role?: string;
  ariaLabel?: string;
  dataTestId?: string;
  parentTag?: string;
  siblingCount?: number;
  /** Whether the element is inside a <form> */
  formParent?: boolean;
}

// ============================================================
// Smart Selectors
// ============================================================

/** A verified selector with fallback chain from the capability graph */
export interface SmartSelector {
  /** Best known selector */
  primary: string;
  /** Ordered by reliability */
  fallbacks: string[];
  /** Semantic selectors: [role="..."], [aria-label="..."] */
  semantic: string[];
  /** When this selector was last execution-verified */
  lastVerifiedAt?: string;
  /** Frameworks where this selector was verified */
  verifiedInBrowsers?: string[];
}

/** Result of attempting to resolve a selector via the smart chain */
export interface SelectorResolution {
  /** The selector that actually matched */
  usedSelector: string;
  /** All selectors that were tried */
  attemptedSelectors: string[];
  /** Time spent on resolution in milliseconds */
  resolutionTimeMs: number;
}

// ============================================================
// Macros
// ============================================================

/** A downloaded execution macro — a pre-verified action sequence for a capability */
export interface Macro {
  id: string;
  domain: string;
  capabilityName: string;
  version: number;
  steps: MacroStep[];
  totalSteps: number;
  /** Confidence score, 0–1 */
  confidence: number;
  /** ISO timestamp of last successful execution */
  lastVerifiedAt: string;
}

/** A single step within a macro */
export interface MacroStep {
  /** Browser action to perform */
  action: ActionType;
  /** Primary CSS selector */
  selector?: string;
  /** Fallback selectors if primary fails */
  fallbackSelectors?: string[];
  /** Maps to a key in the execute() params (e.g., "destination") */
  paramsKey?: string;
  /** Delay after this step in milliseconds */
  waitMs?: number;
  /** Wait for this selector to appear before proceeding */
  waitForSelector?: string;
  /** If true, step can fail without failing the entire macro */
  optional?: boolean;
  /** Human-readable description of what this step does */
  description?: string;
}

/** Outcome of running a macro on a page */
export interface MacroExecutionResult {
  macroId: string;
  version: number;
  success: boolean;
  stepsCompleted: number;
  totalSteps: number;
  /** Index of the step that failed (if any) */
  failedAtStep?: number;
  /** The selector that could not be resolved (if any) */
  failedSelector?: string;
  executionTimeMs: number;
  selectorResolutions: SelectorResolution[];
}

// ============================================================
// Capabilities
// ============================================================

/** A known capability of a website (e.g., "search_flights" on kayak.com) */
export interface Capability {
  id: string;
  domain: string;
  /** Machine-readable name (e.g., "search_flights", "add_to_cart") */
  name: string;
  /** Human-readable description */
  description: string;
  /** Parameters this capability accepts */
  parameters: CapabilityParameter[];
  /** Starting URL for this capability */
  entryUrl?: string;
  /** Interaction pattern */
  actionType: 'form' | 'navigate' | 'search' | 'api' | 'interact' | 'extract';
  /** Confidence score, 0–1 */
  confidence: number;
  /** Whether a macro is available */
  macroAvailable: boolean;
  /** Macro ID (if available) */
  macroId?: string;
  /** Macro version (if available) */
  macroVersion?: number;
  /** Discovery source */
  source: 'community' | 'verified' | 'inferred';
  /** ISO timestamp of last verification (null if never verified) */
  lastVerifiedAt?: string | null;
  /** MPP pricing if this site charges for access */
  mppPricing?: CapabilityPricing;
  /** Data provenance: which product produced this capability */
  dataOrigin?: 'desktop' | 'extract_api';
  /** Trust tier: observed > verified > inferred > crawled */
  confidenceTier?: 'observed' | 'verified' | 'inferred' | 'crawled';
  /** CSS selector from Desktop app observations (if available) */
  selector?: string;
  /** Fallback selectors from Desktop app (ordered by reliability) */
  fallbackSelectors?: string[];
  /** Whether a Desktop-hardened macro exists for this capability */
  hasDesktopMacro?: boolean;

  // ---- Rich Execution Intelligence (available when includeExecution is true) ----

  /** Execution quality tier: api_direct > macro_verified > selector_guided > url_only > description_only */
  executionTier?: 'api_direct' | 'macro_verified' | 'selector_guided' | 'url_only' | 'description_only';
  /** Step-by-step execution macro from Desktop hardening (SDK key holders only) */
  executionMacro?: string | null;
  /** Data extraction patterns for this capability */
  extractionRules?: Record<string, unknown> | null;
  /** Direct API endpoint — skip the browser entirely */
  apiEndpoint?: string | null;
  /** HTTP method for apiEndpoint */
  apiMethod?: string | null;
  /** URL template for navigation (may contain {param} placeholders) */
  navigationUrlTemplate?: string | null;
  /** URL template for search actions */
  searchUrlTemplate?: string | null;
  /** Navigation policy hints (e.g., requires_js_rendering) */
  navigationPolicy?: string | null;
  /** Execution engine requirements (e.g., blocks_headless) */
  executionEnginePolicy?: string | null;
  /** Authentication requirement (e.g., none, login_required, oauth) */
  authRequirement?: string | null;
  /** Capability lifecycle state (discovered_candidate, hardened_macro, validation_eligible) */
  promotionState?: string | null;
  /** Last hardening result (promoted_macro, promoted_script, failed, etc.) */
  lastHardeningResult?: string | null;
  /** Passive validation statistics */
  validationStats?: { attempts: number; successes: number; rate: number } | null;
  /** Recent execution history */
  recentExecutions?: unknown[] | null;
  /** Website category (e-commerce, search, social, etc.) */
  siteType?: string | null;
}

/** A parameter accepted by a capability */
export interface CapabilityParameter {
  name: string;
  type: 'string' | 'number' | 'date' | 'boolean';
  description: string;
  required: boolean;
  defaultValue?: string;
}

/** Pricing info from payment telemetry and agent.json */
export interface CapabilityPricing {
  /** USD per request */
  perRequest: number;
  currency: string;
  protocol: 'mpp';
}

// ============================================================
// Telemetry (SDK → Cloud)
// ============================================================

/** Batch payload sent to POST /api/sdk/telemetry */
export interface TelemetryPayload {
  /** First 7 characters of API key (for rate limiting without exposing key) */
  apiKeyPrefix: string;
  /** SDK package version (e.g., "0.1.0") for compatibility tracking */
  sdkVersion: string;
  events: TelemetryEvent[];
}

/** A single execution session's telemetry */
export interface TelemetryEvent {
  domain: string;
  /** URL path only (no query string) */
  path?: string;
  /** Anonymized action sequence */
  actionSequence: TelemetryAction[];
  sessionOutcome: 'success' | 'failure' | 'partial' | 'unknown' | 'tool_interaction' | 'capability_miss' | 'capability_hit';

  /** If a macro was used during this session */
  macroId?: string;
  macroVersion?: number;
  macroSucceeded?: boolean;

  /** Actions taken after a macro failed */
  recoverySequence?: TelemetryAction[];

  /** Browser and framework metadata */
  browserInfo: BrowserInfo;
  /** Page state signals */
  pageSignals?: PageSignals;

  /** Total session execution time in milliseconds */
  executionTimeMs: number;
  /** ISO timestamp */
  timestamp: string;

  /** MPP payments that occurred during this session */
  payments?: PaymentEvent[];
}

/** A single anonymized action in telemetry (no values, no PII) */
export interface TelemetryAction {
  type: ActionType;
  /** CSS selector used (never contains user values) */
  selector?: string;
  /** Alternative selectors discovered during resolution */
  fallbackSelectors?: string[];
  success: boolean;
  durationMs: number;
  domContext?: DOMContext;
}

/** Browser framework metadata */
export interface BrowserInfo {
  framework: 'playwright' | 'puppeteer' | 'browser-use' | 'selenium' | 'other';
  frameworkVersion: string;
  headless: boolean;
  viewport?: { width: number; height: number };
}

/** Signals about the page state at time of telemetry */
export interface PageSignals {
  readyState: string;
  bodyTextLength: number;
  isAuthRequired?: boolean;
  isCaptcha?: boolean;
  title?: string;
}

// ============================================================
// Feedback (explicit success/failure reports)
// ============================================================

/** Explicit feedback about a macro execution, sent to POST /api/sdk/feedback */
export interface FeedbackPayload {
  macroId: string;
  macroVersion: number;
  success: boolean;
  failedAtStep?: number;
  failedSelector?: string;
  errorType?: 'selector_not_found' | 'timeout' | 'auth_required' | 'captcha' | 'navigation_error' | 'other';
  /** Recovery actions taken after failure */
  recoverySequence?: TelemetryAction[];
}

// ============================================================
// API Responses
// ============================================================

/** Response from GET /api/sdk/capabilities */
export interface CapabilitiesResponse {
  capabilities: Capability[];
  domain: string;
  cached: boolean;
}

/** Response from GET /api/sdk/macro/:id */
export interface MacroResponse {
  macro: Omit<Macro, 'steps'>;
  /** Encrypted macro steps */
  encryptedSteps?: string;
  /** Session key for decryption */
  sessionKey?: string;
}

/** Response from POST /api/sdk/telemetry */
export interface TelemetryResponse {
  accepted: number;
  rejected: number;
  executionsUsed: number;
  executionsLimit: number;
}

/** Error codes emitted by the SDK */
export type AIRErrorCode =
  | 'rate_limited'
  | 'invalid_key'
  | 'macro_not_found'
  | 'capability_not_found'
  | 'execution_limit_reached'
  | 'network_error'
  | 'decryption_error'
  | 'payment_required'
  | 'payment_failed'
  | 'invalid_config'
  | 'timeout';

/** SDK error — extends Error so it has a proper stack trace and works with instanceof */
export class AIRError extends Error {
  readonly code: AIRErrorCode;
  /** Milliseconds to wait before retrying (for rate_limited) */
  readonly retryAfterMs?: number;

  constructor(code: AIRErrorCode, message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'AIRError';
    this.code = code;
    this.retryAfterMs = retryAfterMs;
    // Fix prototype chain for instanceof checks in transpiled code
    Object.setPrototypeOf(this, AIRError.prototype);
  }
}

// ============================================================
// Execute API (high-level capability execution)
// ============================================================

/** Options for the high-level execute() method */
export interface ExecuteOptions {
  /** Capability name (e.g., "search_flights") */
  capability: string;
  /** Website domain (e.g., "kayak.com") */
  domain: string;
  /** Capability parameters (e.g., { destination: "Tokyo" }) */
  params: Record<string, string>;
  /** Total execution timeout in milliseconds */
  timeout?: number;
  /** Progress callback invoked after each macro step */
  onProgress?: (step: number, total: number, description?: string) => void;
  /** Cancellation signal */
  abortSignal?: AbortSignal;
}

/** Result of a high-level execute() call */
export interface ExecuteResult {
  success: boolean;
  /** Whether a macro was used (vs. returning not-found) */
  macroUsed: boolean;
  macroId?: string;
  macroVersion?: number;
  stepsCompleted?: number;
  totalSteps?: number;
  executionTimeMs: number;
  /** True if macro failed and developer's agent handled fallback */
  fallbackUsed: boolean;
  error?: string;
}

// ============================================================
// Adapter Types
// ============================================================

/** Supported browser automation frameworks */
export type SupportedFramework = 'playwright' | 'puppeteer' | 'browser-use' | 'selenium' | 'other';

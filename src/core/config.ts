import type { AIRConfig, ResolvedAIRConfig } from './types';
import { AIRError } from './types';

/** Default values for all optional config fields */
export const DEFAULT_BASE_URL = 'https://api.agentinternetruntime.com';
export const DEFAULT_CACHE_TTL_MS = 1_800_000;           // 30 minutes
export const DEFAULT_TELEMETRY_BATCH_SIZE = 50;
export const DEFAULT_TELEMETRY_FLUSH_INTERVAL_MS = 30_000; // 30 seconds

/** Valid API key prefix */
const API_KEY_PREFIX = 'air_';

/**
 * Merge user-supplied config with defaults.
 * All optional fields are resolved to concrete values.
 */
export function resolveConfig(userConfig: AIRConfig): ResolvedAIRConfig {
  const baseURL = userConfig.baseURL ?? DEFAULT_BASE_URL;
  return {
    apiKey: userConfig.apiKey,
    baseURL: baseURL.replace(/\/+$/, ''),  // strip trailing slashes to prevent double-slash in paths
    telemetryEnabled: userConfig.telemetryEnabled ?? true,
    cacheEnabled: userConfig.cacheEnabled ?? true,
    cacheTTLMs: userConfig.cacheTTLMs ?? DEFAULT_CACHE_TTL_MS,
    telemetryBatchSize: userConfig.telemetryBatchSize ?? DEFAULT_TELEMETRY_BATCH_SIZE,
    telemetryFlushIntervalMs: userConfig.telemetryFlushIntervalMs ?? DEFAULT_TELEMETRY_FLUSH_INTERVAL_MS,
    debug: userConfig.debug ?? false,
    onError: userConfig.onError,
    mpp: userConfig.mpp,
    includeExecution: userConfig.includeExecution,
  };
}

/**
 * Validate config and throw a descriptive AIRError on invalid input.
 * Called at SDK initialization — fail fast on misconfiguration.
 */
export function validateConfig(config: AIRConfig): void {
  // API key: required, must start with "air_"
  if (!config.apiKey) {
    throw configError('apiKey is required');
  }
  if (typeof config.apiKey !== 'string') {
    throw configError('apiKey must be a string');
  }
  if (!config.apiKey.startsWith(API_KEY_PREFIX)) {
    throw configError(`apiKey must start with "${API_KEY_PREFIX}"`);
  }
  if (config.apiKey.length < 10) {
    throw configError('apiKey is too short');
  }

  // Base URL: must be a valid URL if provided
  if (config.baseURL !== undefined) {
    if (typeof config.baseURL !== 'string' || config.baseURL.length === 0) {
      throw configError('baseURL must be a non-empty string');
    }
    try {
      new URL(config.baseURL);
    } catch {
      throw configError(`baseURL is not a valid URL: ${config.baseURL}`);
    }
  }

  // Numeric fields: must be positive
  if (config.cacheTTLMs !== undefined) {
    assertPositiveNumber('cacheTTLMs', config.cacheTTLMs);
  }
  if (config.telemetryBatchSize !== undefined) {
    assertPositiveInteger('telemetryBatchSize', config.telemetryBatchSize);
  }
  if (config.telemetryFlushIntervalMs !== undefined) {
    assertPositiveNumber('telemetryFlushIntervalMs', config.telemetryFlushIntervalMs);
  }

  // MPP config: validate if provided
  if (config.mpp) {
    validateMPPConfig(config.mpp);
  }
}

function validateMPPConfig(mpp: NonNullable<AIRConfig['mpp']>): void {
  if (mpp.enabled) {
    if (!mpp.credential || typeof mpp.credential !== 'string') {
      throw configError('mpp.credential is required when MPP is enabled');
    }
    if (!mpp.paymentMethod) {
      throw configError('mpp.paymentMethod is required when MPP is enabled');
    }
    if (mpp.paymentMethod !== 'stripe_spt' && mpp.paymentMethod !== 'crypto_wallet') {
      throw configError('mpp.paymentMethod must be "stripe_spt" or "crypto_wallet"');
    }
    assertPositiveNumber('mpp.maxPerRequest', mpp.maxPerRequest);
    assertPositiveNumber('mpp.maxPerSession', mpp.maxPerSession);
    if (mpp.maxPerRequest > mpp.maxPerSession) {
      throw configError('mpp.maxPerRequest cannot exceed mpp.maxPerSession');
    }
  }
}

/**
 * Extract the first 7 characters of an API key as a prefix.
 * Used in telemetry payloads (never send the full key in a body).
 */
export function extractApiKeyPrefix(apiKey: string): string {
  return apiKey.slice(0, 7);
}

// ---- internal helpers ----

function assertPositiveNumber(name: string, value: unknown): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw configError(`${name} must be a positive number`);
  }
}

function assertPositiveInteger(name: string, value: unknown): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw configError(`${name} must be a positive integer`);
  }
}

function configError(message: string): AIRError {
  return new AIRError('invalid_config', `AIR SDK config error: ${message}`);
}

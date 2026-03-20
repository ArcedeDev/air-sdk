import { expect, test, describe, vi, beforeEach, afterEach } from 'vitest';
import { TelemetryReporter } from '../../src/core/telemetry';
import { ResolvedAIRConfig, TelemetryEvent } from '../../src/core/types';
import { HttpError } from '../../src/core/http';

describe('TelemetryReporter', () => {
  let config: ResolvedAIRConfig;
  let mockHttpClient: any;

  beforeEach(() => {
    vi.useFakeTimers();
    config = {
      apiKey: 'air_live_1234567890',
      baseURL: 'https://api.air.com',
      telemetryEnabled: true,
      cacheEnabled: true,
      cacheTTLMs: 30000,
      telemetryBatchSize: 5,
      telemetryFlushIntervalMs: 30000,
      debug: false
    };

    mockHttpClient = {
      post: vi.fn().mockResolvedValue({ accepted: 5, rejected: 0, executionsUsed: 10, executionsLimit: 1000 })
    };
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  function createEvent(): TelemetryEvent {
    return {
      domain: 'example.com',
      actionSequence: [],
      sessionOutcome: 'success',
      executionTimeMs: 100,
      browserInfo: { framework: 'playwright', frameworkVersion: '1', headless: true },
      timestamp: new Date().toISOString()
    };
  }

  test('buffers events without blocking', () => {
    const reporter = new TelemetryReporter(config, mockHttpClient);
    reporter.enqueue(createEvent());
    expect(reporter.bufferSize).toBe(1);
    expect(mockHttpClient.post).not.toHaveBeenCalled();
  });

  test('auto-flushes on batch size', async () => {
    const reporter = new TelemetryReporter(config, mockHttpClient);
    for (let i = 0; i < 5; i++) reporter.enqueue(createEvent());

    // Because flush is async and triggered internally
    await Promise.resolve(); 
    
    expect(reporter.bufferSize).toBe(0);
    expect(mockHttpClient.post).toHaveBeenCalledTimes(1);
    const payload = mockHttpClient.post.mock.calls[0][1];
    expect(payload.apiKeyPrefix).toBe('air_liv'); // first 7 chars
    expect(payload.events.length).toBe(5);
  });

  test('timer flushes partial batch', async () => {
    const reporter = new TelemetryReporter(config, mockHttpClient);
    reporter.enqueue(createEvent());
    
    vi.advanceTimersByTime(30000);
    await Promise.resolve();

    expect(mockHttpClient.post).toHaveBeenCalledTimes(1);
    expect(reporter.bufferSize).toBe(0);
  });

  test('no-op when disabled', () => {
    config.telemetryEnabled = false;
    const reporter = new TelemetryReporter(config, mockHttpClient);
    reporter.enqueue(createEvent());
    expect(reporter.bufferSize).toBe(0);
    expect(mockHttpClient.post).not.toHaveBeenCalled();
  });

  test('error swallowing', async () => {
    mockHttpClient.post.mockRejectedValue(new Error('Network Down'));
    const reporter = new TelemetryReporter(config, mockHttpClient);
    reporter.enqueue(createEvent());
    vi.advanceTimersByTime(30000);
    await Promise.resolve();

    // No error should be thrown upwards
    expect(mockHttpClient.post).toHaveBeenCalledTimes(1);
    expect(reporter.bufferSize).toBe(0); // dropped
  });

  test('429 rate limit retry', async () => {
    mockHttpClient.post.mockRejectedValue({
      name: 'HttpError',
      status: 429,
      response: { headers: { get: (k: string) => k === 'Retry-After' ? '2' : null } }
    });
    
    const reporter = new TelemetryReporter(config, mockHttpClient);
    reporter.enqueue(createEvent());
    
    // Initial flush
    await vi.advanceTimersByTimeAsync(30000);
    
    expect(mockHttpClient.post).toHaveBeenCalledTimes(1);
    expect(reporter.bufferSize).toBe(1); // Re-queued
    
    // Wait for retry (2 seconds)
    mockHttpClient.post.mockResolvedValue({ accepted: 1, rejected: 0 }); // success next time
    await vi.advanceTimersByTimeAsync(2000);

    expect(mockHttpClient.post).toHaveBeenCalledTimes(2);
    expect(reporter.bufferSize).toBe(0); // done!
  });

  test('shutdown flushes and clears timers', async () => {
    const reporter = new TelemetryReporter(config, mockHttpClient);
    reporter.enqueue(createEvent());

    const shutdownPromise = reporter.shutdown();
    await Promise.resolve();

    expect(mockHttpClient.post).toHaveBeenCalledTimes(1);
    expect(reporter.bufferSize).toBe(0);

    // Timer should be cleared
    reporter.enqueue(createEvent()); // No-op after shutdown
    expect(reporter.bufferSize).toBe(0);
  });

  test('concurrent flush is prevented by _isFlushing guard', async () => {
    // Make post slow so the first flush is still in-flight when second triggers
    let resolvePost!: () => void;
    mockHttpClient.post.mockReturnValue(new Promise<any>((resolve) => {
      resolvePost = () => resolve({ accepted: 1, rejected: 0, executionsUsed: 1, executionsLimit: 1000 });
    }));

    const reporter = new TelemetryReporter(config, mockHttpClient);
    reporter.enqueue(createEvent());

    // Start first flush (will hang on the slow post)
    const flush1 = reporter.flush();

    // Enqueue another event and try to flush concurrently
    reporter.enqueue(createEvent());
    const flush2 = reporter.flush();

    // Second flush should be a no-op — event stays in buffer
    expect(reporter.bufferSize).toBe(1);

    // Resolve the first flush
    resolvePost();
    await flush1;
    await flush2;

    // Only one HTTP call from the first flush
    expect(mockHttpClient.post).toHaveBeenCalledTimes(1);
  });
});

// --- parseRetryAfter ---

import { parseRetryAfter } from '../../src/core/telemetry';

describe('parseRetryAfter', () => {
  test('parses numeric delta-seconds', () => {
    expect(parseRetryAfter('120')).toBe(120_000);
    expect(parseRetryAfter('5')).toBe(5_000);
    expect(parseRetryAfter('0.5')).toBe(500);
  });

  test('parses HTTP-date format', () => {
    const futureDate = new Date(Date.now() + 60_000).toUTCString();
    const ms = parseRetryAfter(futureDate);
    // Should be roughly 60 seconds (within 2s tolerance for test execution)
    expect(ms).toBeGreaterThan(55_000);
    expect(ms).toBeLessThan(65_000);
  });

  test('returns default 5000ms for null/undefined/empty', () => {
    expect(parseRetryAfter(null)).toBe(5_000);
    expect(parseRetryAfter(undefined)).toBe(5_000);
    expect(parseRetryAfter('')).toBe(5_000);
  });

  test('returns default 5000ms for unparseable values', () => {
    expect(parseRetryAfter('not-a-number-or-date')).toBe(5_000);
  });

  test('returns default for past HTTP-date', () => {
    const pastDate = new Date(Date.now() - 60_000).toUTCString();
    expect(parseRetryAfter(pastDate)).toBe(5_000);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIRHttpClient, HttpError } from '../../src/core/http';
import type { ResolvedAIRConfig } from '../../src/core/types';

const config: ResolvedAIRConfig = {
  apiKey: 'air_test_1234567890',
  baseURL: 'https://api.test.com',
  telemetryEnabled: true,
  cacheEnabled: true,
  cacheTTLMs: 30_000,
  telemetryBatchSize: 50,
  telemetryFlushIntervalMs: 30_000,
  debug: false,
};

describe('AIRHttpClient', () => {
  let client: AIRHttpClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    client = new AIRHttpClient(config);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- GET ---

  it('GET sends correct URL, method, and auth header', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: 'ok' }),
    });

    await client.get('/api/v1/sdk/capabilities', { domain: 'kayak.com' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.test.com/api/v1/sdk/capabilities?domain=kayak.com');
    expect(opts.method).toBe('GET');
    expect(opts.headers['Authorization']).toBe('Bearer air_test_1234567890');
    expect(opts.headers['Content-Type']).toBe('application/json');
  });

  it('GET without params sends no query string', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    await client.get('/api/v1/sdk/capabilities');

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.test.com/api/v1/sdk/capabilities');
  });

  it('GET returns parsed JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ capabilities: [{ name: 'test' }] }),
    });

    const result = await client.get<{ capabilities: { name: string }[] }>('/test');
    expect(result.capabilities[0].name).toBe('test');
  });

  // --- POST ---

  it('POST sends JSON body with correct headers', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ accepted: 5 }),
    });

    await client.post('/api/v1/sdk/telemetry', { events: [] });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.test.com/api/v1/sdk/telemetry');
    expect(opts.method).toBe('POST');
    expect(opts.body).toBe(JSON.stringify({ events: [] }));
  });

  // --- Error handling ---

  it('throws HttpError on non-OK response', async () => {
    const mockResponse = {
      ok: false,
      status: 401,
      json: async () => ({ error: 'invalid_key' }),
    };
    fetchMock.mockResolvedValue(mockResponse);

    try {
      await client.get('/test');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      const httpErr = err as HttpError;
      expect(httpErr.status).toBe(401);
      expect(httpErr.message).toBe('HTTP error 401');
      expect(httpErr.response).toBe(mockResponse);
    }
  });

  it('HttpError is an instance of Error', () => {
    const mockResponse = { ok: false, status: 500 } as Response;
    const err = new HttpError(500, mockResponse, 'Server error');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('HttpError');
    expect(err.status).toBe(500);
  });

  it('throws on network failure (fetch rejects)', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(client.get('/test')).rejects.toThrow('Failed to fetch');
  });

  // --- Timeout ---

  it('aborts request after timeout', async () => {
    // Make fetch hang until aborted
    fetchMock.mockImplementation((_url: string, opts: any) => {
      return new Promise((_, reject) => {
        opts.signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    });

    await expect(client.get('/slow')).rejects.toThrow('aborted');
  }, 15_000);

  // --- Cleanup ---

  it('clears timeout on success (no leaked timers)', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    await client.get('/test');

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});

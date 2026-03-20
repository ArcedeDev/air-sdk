import { ResolvedAIRConfig, TelemetryEvent, TelemetryPayload, TelemetryResponse } from './types';
import { AIRHttpClient, HttpError } from './http';
import { SDK_VERSION } from '../version';

export class TelemetryReporter {
  private buffer: TelemetryEvent[] = [];
  private timer: NodeJS.Timeout | null = null;
  private config: ResolvedAIRConfig;
  private httpClient: AIRHttpClient;
  private _isFlushing: boolean = false;
  private _isShutdown: boolean = false;
  private retriedEvents = new WeakSet<TelemetryEvent>();

  constructor(config: ResolvedAIRConfig, httpClient?: AIRHttpClient) {
    this.config = config;
    this.httpClient = httpClient || new AIRHttpClient(config);
    if (this.config.telemetryEnabled) {
      this.startTimer();
    }
  }

  private startTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.flush().catch(() => {});
    }, this.config.telemetryFlushIntervalMs || 30000);
    if (this.timer.unref) this.timer.unref();
  }

  // Add an event to the buffer. Non-blocking. Never throws.
  enqueue(event: TelemetryEvent): void {
    if (!this.config.telemetryEnabled || this._isShutdown) return;

    this.buffer.push(event);

    if (this.buffer.length >= (this.config.telemetryBatchSize || 50)) {
      this.flush().catch(() => {});
    }
  }

  // Force flush all buffered events. Returns when complete.
  async flush(): Promise<void> {
    if (!this.config.telemetryEnabled || this.buffer.length === 0 || this._isFlushing) return;
    
    this._isFlushing = true;

    try {
      const eventsToFlush = this.buffer.splice(0, this.buffer.length);
      const prefix = this.config.apiKey.length > 7 ? this.config.apiKey.slice(0, 7) : this.config.apiKey;

      const payload: TelemetryPayload = {
        apiKeyPrefix: prefix,
        sdkVersion: SDK_VERSION,
        events: eventsToFlush
      };

      await this.sendWithRetry(payload, eventsToFlush);
    } finally {
      this._isFlushing = false;
    }
  }

  private async sendWithRetry(payload: TelemetryPayload, events: TelemetryEvent[], retryCount = 0): Promise<void> {
    try {
      const resp = await this.httpClient.post<TelemetryResponse>('/api/v1/sdk/telemetry', payload);
      if (this.config.debug) {
        console.log(`[AIR Telemetry] Accepted: ${resp.accepted}, Rejected: ${resp.rejected}`);
      }
    } catch (e) {
      // Swallowing errors to never crash developer process
      if (retryCount > 0) return; // Drop on second failure

      const err = e as any;
      if (err instanceof HttpError || err.name === 'HttpError' || err.status) {
        if (err.status === 429 || (err.status >= 500 && err.status < 600)) {
          const isRetried = events.some((ev: any) => this.retriedEvents.has(ev));
          if (isRetried) return; // NEVER retry more than once
          
          events.forEach((ev: any) => this.retriedEvents.add(ev));
          
          const retryAfter = err.status === 429 ? err.response?.headers?.get('Retry-After') : null;
          const ms = parseRetryAfter(retryAfter);
          
          this.buffer = [...events, ...this.buffer];
          setTimeout(() => this.flush().catch(() => {}), ms);
        }
      } else if (this.config.onError && e instanceof Error) {
        this.config.onError(e as any);
      }
    }
  }

  // Graceful shutdown: flush remaining events, stop timer.
  async shutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this._isShutdown = true;
    
    if (this.buffer.length > 0) {
       try {
         const flushPromise = this.flush();
         const timeoutPromise = new Promise((_, reject) => {
           const t = setTimeout(() => reject(new Error('Timeout')), 5000);
           if (typeof t.unref === 'function') t.unref();
         });
         await Promise.race([flushPromise, timeoutPromise]);
       } catch (e) {
         // silently absorb timeout
       }
    }
  }

  get bufferSize(): number {
    return this.buffer.length;
  }

  get enabled(): boolean {
    return !!this.config.telemetryEnabled;
  }
}

/**
 * Parse an HTTP Retry-After header value into milliseconds.
 * Supports both delta-seconds ("120") and HTTP-date ("Sun, 06 Nov 2025 08:49:37 GMT").
 * Returns 5000ms on any parse failure.
 */
export function parseRetryAfter(value: string | null | undefined): number {
  const DEFAULT_MS = 5000;
  if (!value) return DEFAULT_MS;

  // Try numeric delta-seconds first (most common)
  const numeric = Number(value);
  if (!Number.isNaN(numeric) && numeric > 0) {
    return numeric * 1000;
  }

  // Try HTTP-date format (RFC 7231)
  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) {
    const delayMs = dateMs - Date.now();
    return delayMs > 0 ? delayMs : DEFAULT_MS;
  }

  return DEFAULT_MS;
}

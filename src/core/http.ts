import { ResolvedAIRConfig } from './types';

export class HttpError extends Error {
  constructor(public status: number, public response: Response, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export class AIRHttpClient {
  constructor(private config: ResolvedAIRConfig) {
    if (
      !config.baseURL.startsWith('https://') &&
      !config.baseURL.startsWith('http://localhost')
    ) {
      console.warn(
        `[AIR SDK] Warning: baseURL "${config.baseURL}" does not use HTTPS. ` +
        'Consider using HTTPS in production to protect API keys in transit.'
      );
    }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.config.baseURL}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
          'X-AIR-Client': this.config.clientId || 'air-sdk',
          'X-AIR-SDK-Version': this.config.sdkVersion || '0.3.0',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });

      if (!response.ok) {
        throw new HttpError(response.status, response, `HTTP error ${response.status}`);
      }

      return await response.json() as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return this.request<T>('GET', `${path}${query}`);
  }
}

import * as crypto from 'node:crypto';
import type {
  Capability,
  Macro,
  SmartSelector,
  ResolvedAIRConfig,
  CapabilitiesResponse,
  MacroResponse,
  MacroStep,
  AIRErrorCode,
} from './types';
import { AIRError } from './types';
import type { AIRHttpClient } from './http';

export class CapabilityCache {
  private static readonly MAX_CAPABILITIES = 500;
  private static readonly MAX_MACROS = 1000;
  private static readonly MAX_SELECTORS = 5000;

  private capabilities = new Map<string, { data: Capability[]; fetchedAt: number }>();
  private macros = new Map<string, { data: Macro; fetchedAt: number }>();
  // key format: "domain::selector"
  private smartSelectors = new Map<string, { data: SmartSelector; fetchedAt: number }>();

  constructor(
    private config: ResolvedAIRConfig,
    private httpClient: AIRHttpClient
  ) {}

  /**
   * Preload capabilities for a domain (called on navigation).
   * Fetches capabilities, parses macros if available, and builds smart selectors.
   */
  async preload(domain: string): Promise<Capability[]> {
    if (!this.config.cacheEnabled) {
      return this.fetchCapabilities(domain);
    }
    const caps = await this.getCapabilities(domain);

    const macroPromises = caps
      .filter((c) => c.macroAvailable && c.macroId)
      .map((c) => this.getMacro(c.macroId!));

    await Promise.all(macroPromises);
    return caps;
  }

  /**
   * Get capabilities for a domain (cache-first)
   */
  async getCapabilities(domain: string): Promise<Capability[]> {
    if (!this.config.cacheEnabled) {
      return this.fetchCapabilities(domain);
    }

    const cached = this.capabilities.get(domain);
    if (cached && this.isValid(cached.fetchedAt)) {
      return cached.data;
    }

    const capabilities = await this.fetchCapabilities(domain);
    if (capabilities.length > 0) {
      this.capabilities.set(domain, { data: capabilities, fetchedAt: Date.now() });
      this.trimToSize(this.capabilities, CapabilityCache.MAX_CAPABILITIES);
    }
    return capabilities;
  }

  /**
   * Get a specific macro by ID (cache-first)
   */
  async getMacro(macroId: string): Promise<Macro | null> {
    if (!this.config.cacheEnabled) {
      return this.fetchMacro(macroId);
    }

    const cached = this.macros.get(macroId);
    if (cached && this.isValid(cached.fetchedAt)) {
      return cached.data;
    }

    const macro = await this.fetchMacro(macroId);
    if (macro) {
      this.macros.set(macroId, { data: macro, fetchedAt: Date.now() });
      this.trimToSize(this.macros, CapabilityCache.MAX_MACROS);
      this.buildSmartSelectors(macro.domain, macroId, [macro]);
    }
    return macro;
  }

  /**
   * Get macro for a domain + capability name (convenience)
   */
  async getMacroForCapability(domain: string, capabilityName: string): Promise<Macro | null> {
    const caps = await this.getCapabilities(domain);
    const capability = caps.find((c) => c.name === capabilityName);
    
    if (!capability || !capability.macroId) {
      return null;
    }

    return this.getMacro(capability.macroId);
  }

  /**
   * Get smart selector for a domain + original selector
   */
  getSmartSelector(domain: string, selector: string): SmartSelector | null {
    if (!this.config.cacheEnabled) return null;
    return this.smartSelectors.get(domain + '::' + selector)?.data ?? null;
  }

  /** Build smart selectors from macro step data. */
  private buildSmartSelectors(domain: string, _source: string, macros: Macro[]): void {
    const now = Date.now();
    for (const macro of macros) {
      for (const step of macro.steps) {
        if (!step.selector) continue;

        const key = domain + '::' + step.selector;
        const existing = this.smartSelectors.get(key);
        if (!existing) {
          this.smartSelectors.set(key, {
            data: {
              primary: step.selector,
              fallbacks: step.fallbackSelectors || [],
              semantic: [],
            },
            fetchedAt: now,
          });
        } else {
          const merged = Array.from(new Set([...existing.data.fallbacks, ...(step.fallbackSelectors || [])]));
          existing.data.fallbacks = merged;
          existing.fetchedAt = now;
        }
      }
    }
    this.trimToSize(this.smartSelectors, CapabilityCache.MAX_SELECTORS);
  }

  /** Remove stale entries (past TTL) from all caches. */
  purgeStale(): void {
    const now = Date.now();
    const ttl = this.config.cacheTTLMs;
    for (const [key, entry] of this.capabilities) {
      if (now - entry.fetchedAt >= ttl) this.capabilities.delete(key);
    }
    for (const [key, entry] of this.macros) {
      if (now - entry.fetchedAt >= ttl) this.macros.delete(key);
    }
    for (const [key, entry] of this.smartSelectors) {
      if (now - entry.fetchedAt >= ttl) this.smartSelectors.delete(key);
    }
  }

  private isValid(fetchedAt: number): boolean {
    return Date.now() - fetchedAt < this.config.cacheTTLMs;
  }

  /**
   * Trim a Map down to maxSize by removing the oldest entries.
   * Called once after a batch of insertions — NOT inside a loop.
   */
  private trimToSize<V extends { fetchedAt: number }>(map: Map<string, V>, maxSize: number): void {
    if (map.size <= maxSize) return;
    // Sort entries by fetchedAt ascending, then delete the oldest ones
    const entries = Array.from(map.entries());
    entries.sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
    const toRemove = entries.length - maxSize;
    for (let i = 0; i < toRemove; i++) {
      map.delete(entries[i][0]);
    }
  }

  /**
   * Clear all cached data
   */
  clear(): void {
    this.capabilities.clear();
    this.macros.clear();
    this.smartSelectors.clear();
  }

  /**
   * Cache stats (for debugging)
   */
  get stats(): { capabilities: number; macros: number; selectors: number } {
    return {
      capabilities: this.capabilities.size,
      macros: this.macros.size,
      selectors: this.smartSelectors.size,
    };
  }

  // --- Network Fetching Private Helpers ---

  private async fetchCapabilities(domain: string): Promise<Capability[]> {
    try {
      const params: Record<string, string> = { domain };
      if (this.config.includeExecution) {
        params.include = 'execution';
      }
      const response = await this.httpClient.get<CapabilitiesResponse>('/api/v1/sdk/capabilities', params);
      const capabilities = response.capabilities || [];

      // Build smart selectors from Desktop-sourced capability data
      // (Desktop capabilities include battle-tested CSS selectors)
      this.buildDesktopSelectors(domain, capabilities);

      return capabilities;
    } catch (err: any) {
      // Propagate quota/auth errors so MCP tools can show helpful messages
      if (err?.status === 429 || err?.status === 401 || err?.status === 403) {
        throw err;
      }
      // Try to detect quota_exceeded from response body
      if (err?.response && typeof err.response.json === 'function') {
        try {
          const body = await err.response.json();
          if (body?.error === 'quota_exceeded' || body?.error === 'invalid_api_key') {
            throw Object.assign(err, { _parsedBody: body });
          }
        } catch (parseErr) {
          if (parseErr === err) throw err; // re-throw if it's our enriched error
        }
      }
      this.handleError('network_error', 'Failed to fetch capabilities for ' + domain + ': ' + err.message);
      return [];
    }
  }

  /**
   * Build SmartSelectors from Desktop capability data.
   * Desktop capabilities carry battle-tested CSS selectors that can serve
   * as high-quality fallbacks for SDK macro execution.
   */
  private buildDesktopSelectors(domain: string, capabilities: Capability[]): void {
    const now = Date.now();
    for (const cap of capabilities) {
      if (!cap.selector || cap.dataOrigin !== 'desktop') continue;

      const key = domain + '::' + cap.selector;
      const existing = this.smartSelectors.get(key);
      if (!existing) {
        this.smartSelectors.set(key, {
          data: {
            primary: cap.selector,
            fallbacks: cap.fallbackSelectors || [],
            semantic: [],
          },
          fetchedAt: now,
        });
      } else {
        // Merge Desktop fallbacks with existing ones
        const merged = Array.from(new Set([
          ...existing.data.fallbacks,
          ...(cap.fallbackSelectors || []),
        ]));
        existing.data.fallbacks = merged;
        existing.fetchedAt = now;
      }
    }
    this.trimToSize(this.smartSelectors, CapabilityCache.MAX_SELECTORS);
  }

  private async fetchMacro(macroId: string): Promise<Macro | null> {
    try {
      const response = await this.httpClient.get<MacroResponse>('/api/v1/sdk/macro/' + macroId);
      if (!response || !response.macro) {
        return null;
      }

      let steps: MacroStep[] = [];
      if (response.encryptedSteps && response.sessionKey) {
        steps = this.decryptSteps(response.encryptedSteps, response.sessionKey);
      }
      
      const fullMacro: Macro = {
        ...response.macro,
        steps
      };
      
      return fullMacro;
    } catch (err: any) {
      this.handleError('network_error', 'Failed to fetch macro ' + macroId + ': ' + err.message);
      return null;
    }
  }

  /** Decrypt encoded macro steps */
  private decryptSteps(encrypted: string, sessionKeyBase64: string): MacroStep[] {
    try {
      const parts = encrypted.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid encrypted steps payload format');
      }

      const [ivB64, cipherB64, tagB64] = parts;
      const key = Buffer.from(sessionKeyBase64, 'base64');
      const iv = Buffer.from(ivB64, 'base64');
      const authTag = Buffer.from(tagB64, 'base64');

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(cipherB64, 'base64', 'utf8');
      decrypted += decipher.final('utf8');

      return JSON.parse(decrypted) as MacroStep[];
    } catch (err: any) {
      this.handleError('decryption_error', 'Macro decryption failed: ' + err.message);
      return [];
    }
  }

  private handleError(code: AIRErrorCode, message: string): void {
    if (this.config.debug) {
      console.warn('[AIR-SDK Cache] ' + code + ': ' + message);
    }
    if (this.config.onError) {
      this.config.onError(new AIRError(code, message));
    }
  }
}

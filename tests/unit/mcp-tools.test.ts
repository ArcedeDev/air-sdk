import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleToolCall, tools } from '../../src/mcp/tools';
import type { CapabilityCache } from '../../src/core/capability-cache';
import type { AIRHttpClient } from '../../src/core/http';
import type { Capability, Macro } from '../../src/core/types';

// ---- Mock factories ----

function mockCapability(overrides: Partial<Capability> = {}): Capability {
  return {
    id: 'cap-1',
    domain: 'kayak.com',
    name: 'search_flights',
    description: 'Search for flights',
    parameters: [
      { name: 'destination', type: 'string', description: 'Where to fly', required: true },
    ],
    entryUrl: 'https://kayak.com/flights',
    actionType: 'form',
    confidence: 0.92,
    macroAvailable: true,
    macroId: 'macro-1',
    macroVersion: 3,
    source: 'community',
    lastVerifiedAt: '2026-03-18T00:00:00Z',
    ...overrides,
  };
}

function mockMacro(overrides: Partial<Macro> = {}): Macro {
  return {
    id: 'macro-1',
    domain: 'kayak.com',
    capabilityName: 'search_flights',
    version: 3,
    totalSteps: 3,
    confidence: 0.92,
    lastVerifiedAt: '2026-03-18T00:00:00Z',
    steps: [
      { action: 'navigate', description: 'Go to flights page' },
      { action: 'fill', selector: '#destination', paramsKey: 'destination', description: 'Enter destination' },
      { action: 'click', selector: '.search-btn', description: 'Submit search', waitForSelector: '.results' },
    ],
    ...overrides,
  };
}

function createMockCache(capabilities: Capability[] = [], macro: Macro | null = null) {
  return {
    getCapabilities: vi.fn().mockResolvedValue(capabilities),
    getMacroForCapability: vi.fn().mockResolvedValue(macro),
    getMacro: vi.fn().mockResolvedValue(macro),
    preload: vi.fn().mockResolvedValue(capabilities),
    getSmartSelector: vi.fn().mockReturnValue(null),
    clear: vi.fn(),
    stats: { capabilities: 0, macros: 0, selectors: 0 },
  } as unknown as CapabilityCache;
}

function createMockHttpClient(response: unknown = { capabilities: [] }) {
  return {
    get: vi.fn().mockResolvedValue(response),
    post: vi.fn().mockResolvedValue({}),
  } as unknown as AIRHttpClient;
}

// ---- Tests ----

describe('MCP Tools', () => {
  describe('tool definitions', () => {
    it('exports exactly 4 tools', () => {
      expect(tools).toHaveLength(4);
    });

    it('all tools have name, description, and inputSchema', () => {
      for (const tool of tools) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
      }
    });

    it('tool names match expected values', () => {
      const names = tools.map(t => t.name);
      expect(names).toContain('extract_url');
      expect(names).toContain('browse_capabilities');
      expect(names).toContain('execute_capability');
      expect(names).toContain('report_outcome');
    });
  });

  describe('extract_url', () => {
    it('returns formatted extraction for a valid URL', async () => {
      const cache = createMockCache();
      const http = createMockHttpClient();
      (http.post as any).mockResolvedValue({
        success: true,
        data: {
          title: 'Example Page',
          description: 'A test page',
          url: 'https://example.com',
          diagnostics: {
            extractionMethod: 'json-ld',
            itemsExtracted: 3,
            extractionTimeMs: 250,
          },
          content: { type: 'article', items: [{ text: 'hello' }] },
        },
        credits_used: 1.0,
        credits_remaining: 99,
      });

      const result = await handleToolCall('extract_url', { url: 'https://example.com' }, cache, http);

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('Example Page');
      expect(result.content[0].text).toContain('json-ld');
      expect(result.content[0].text).toContain('250ms');
      expect(result.content[0].text).toContain('1 used');
      expect((http.post as any)).toHaveBeenCalledWith('/api/v1/extract', {
        url: 'https://example.com',
        options: {},
      });
    });

    it('returns error when URL is missing', async () => {
      const cache = createMockCache();
      const http = createMockHttpClient();

      const result = await handleToolCall('extract_url', {}, cache, http);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required parameter: url');
    });

    it('handles API failure gracefully', async () => {
      const cache = createMockCache();
      const http = createMockHttpClient();
      (http.post as any).mockRejectedValue(new Error('Network error'));

      const result = await handleToolCall('extract_url', { url: 'https://broken.com' }, cache, http);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Extraction failed');
    });

    it('handles non-success API response', async () => {
      const cache = createMockCache();
      const http = createMockHttpClient();
      (http.post as any).mockResolvedValue({
        success: false,
        error: 'quota_exceeded',
        message: 'Free plan limit reached',
      });

      const result = await handleToolCall('extract_url', { url: 'https://example.com' }, cache, http);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('quota_exceeded');
    });

    it('passes force parameter when true', async () => {
      const cache = createMockCache();
      const http = createMockHttpClient();
      (http.post as any).mockResolvedValue({
        success: true,
        data: { title: 'Test', url: 'https://example.com' },
      });

      await handleToolCall('extract_url', { url: 'https://example.com', force: true }, cache, http);

      expect((http.post as any)).toHaveBeenCalledWith('/api/v1/extract', {
        url: 'https://example.com',
        options: { force: true },
      });
    });

    it('shows cache hit info when served from cache', async () => {
      const cache = createMockCache();
      const http = createMockHttpClient();
      (http.post as any).mockResolvedValue({
        success: true,
        data: {
          title: 'Cached Page',
          url: 'https://example.com',
          diagnostics: { servedFromCache: true, cacheAge: 120 },
        },
        credits_used: 0.1,
      });

      const result = await handleToolCall('extract_url', { url: 'https://example.com' }, cache, http);

      expect(result.content[0].text).toContain('**Cache:** hit');
      expect(result.content[0].text).toContain('120s old');
    });
  });

  describe('browse_capabilities', () => {
    it('returns capabilities for a valid domain', async () => {
      const cap = mockCapability();
      const cache = createMockCache([cap]);
      const http = createMockHttpClient();

      const result = await handleToolCall('browse_capabilities', { domain: 'kayak.com' }, cache, http);

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('kayak.com');
      expect(result.content[0].text).toContain('search_flights');
      expect(result.content[0].text).toContain('92%');
      expect(result.content[0].text).toContain('Macro:');
      expect(cache.getCapabilities).toHaveBeenCalledWith('kayak.com');
    });

    it('returns helpful message when no capabilities found', async () => {
      const cache = createMockCache([]);
      const http = createMockHttpClient();

      const result = await handleToolCall('browse_capabilities', { domain: 'unknown.com' }, cache, http);

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('No known capabilities');
    });

    it('returns error when domain is missing', async () => {
      const cache = createMockCache();
      const http = createMockHttpClient();

      const result = await handleToolCall('browse_capabilities', {}, cache, http);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required parameter: domain');
    });

    it('shows parameter details when available', async () => {
      const cap = mockCapability();
      const cache = createMockCache([cap]);
      const http = createMockHttpClient();

      const result = await handleToolCall('browse_capabilities', { domain: 'kayak.com' }, cache, http);

      expect(result.content[0].text).toContain('destination');
      expect(result.content[0].text).toContain('required');
    });
  });

  describe('search_capabilities (removed)', () => {
    it('returns removal notice instead of searching', async () => {
      const cache = createMockCache();
      const http = createMockHttpClient();

      const result = await handleToolCall('search_capabilities', { query: 'flights' }, cache, http);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('removed');
      expect(result.content[0].text).toContain('browse_capabilities');
    });
  });

  describe('execute_capability', () => {
    it('returns formatted macro steps with resolved params', async () => {
      const macro = mockMacro();
      const cache = createMockCache([mockCapability()], macro);
      const http = createMockHttpClient();

      const result = await handleToolCall(
        'execute_capability',
        { domain: 'kayak.com', capability: 'search_flights', params: { destination: 'Tokyo' } },
        cache,
        http
      );

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      expect(text).toContain('search_flights');
      expect(text).toContain('kayak.com');
      expect(text).toContain('Step 1');
      expect(text).toContain('Step 2');
      expect(text).toContain('Step 3');
      expect(text).toContain('"Tokyo"'); // Resolved param
      expect(text).toContain('#destination'); // Selector
      expect(text).toContain('.search-btn'); // Selector
      expect(text).toContain('macro-1'); // Macro ID
    });

    it('returns guidance when macro is not available', async () => {
      const cache = createMockCache([mockCapability()], null);
      const http = createMockHttpClient();

      const result = await handleToolCall(
        'execute_capability',
        { domain: 'kayak.com', capability: 'search_flights', params: {} },
        cache,
        http
      );

      // Should NOT be an error — it's guidance for the agent
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('No pre-verified macro or selectors');
      expect(result.content[0].text).toContain('report_outcome');
      expect(result.content[0].text).toContain('Suggested approach');
    });

    it('returns error when domain is missing', async () => {
      const cache = createMockCache();
      const http = createMockHttpClient();

      const result = await handleToolCall(
        'execute_capability',
        { capability: 'search_flights', params: {} },
        cache,
        http
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required parameter: domain');
    });

    it('returns error when capability is missing', async () => {
      const cache = createMockCache();
      const http = createMockHttpClient();

      const result = await handleToolCall(
        'execute_capability',
        { domain: 'kayak.com', params: {} },
        cache,
        http
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required parameter: capability');
    });

    it('includes fallback selectors and wait instructions', async () => {
      const macro = mockMacro({
        steps: [
          {
            action: 'click',
            selector: '.btn',
            fallbackSelectors: ['[data-testid="submit"]', '[aria-label="Submit"]'],
            waitMs: 500,
            waitForSelector: '.loaded',
            description: 'Click submit',
          },
        ],
        totalSteps: 1,
      });
      const cache = createMockCache([], macro);
      const http = createMockHttpClient();

      const result = await handleToolCall(
        'execute_capability',
        { domain: 'test.com', capability: 'test', params: {} },
        cache,
        http
      );

      const text = result.content[0].text;
      expect(text).toContain('Fallback: `[data-testid="submit"]`');
      expect(text).toContain('Fallback: `[aria-label="Submit"]`');
      expect(text).toContain('Wait 500ms');
      expect(text).toContain('Wait for `.loaded`');
    });
  });

  describe('unknown tool', () => {
    it('returns error for unknown tool name', async () => {
      const cache = createMockCache();
      const http = createMockHttpClient();

      const result = await handleToolCall('nonexistent_tool', {}, cache, http);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Unknown tool');
    });
  });

  describe('error handling', () => {
    it('catches thrown errors and returns error result', async () => {
      const cache = {
        getCapabilities: vi.fn().mockRejectedValue(new Error('Cache exploded')),
      } as unknown as CapabilityCache;
      const http = createMockHttpClient();

      const result = await handleToolCall('browse_capabilities', { domain: 'test.com' }, cache, http);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Cache exploded');
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CapabilityExecutor } from '../../src/execute/executor';
import type { CapabilityCache } from '../../src/core/capability-cache';
import type { MacroRunner } from '../../src/core/macro-runner';
import type { TelemetryReporter } from '../../src/core/telemetry';
import type { AIRHttpClient } from '../../src/core/http';
import type { Capability, Macro } from '../../src/core/types';

describe('CapabilityExecutor', () => {
  let mockCache: any;
  let mockRunner: any;
  let mockHttp: any;
  let executor: CapabilityExecutor;
  let mockCap: Capability;

  beforeEach(() => {
    mockCap = {
      id: 'c1', name: 'search', domain: 'test.com', description: 'Search',
      parameters: [], actionType: 'form', confidence: 1,
      macroAvailable: true, macroId: 'm1',
      source: 'verified', lastVerifiedAt: ''
    };
    const mockMacro: Macro = {
      id: 'm1', capabilityName: 'search', domain: 'test.com', version: 1,
      confidence: 1, lastVerifiedAt: '', totalSteps: 1, steps: []
    };

    mockCache = {
      getCapabilities: vi.fn().mockResolvedValue([mockCap]),
      getMacro: vi.fn().mockResolvedValue(mockMacro)
    };
    mockRunner = {
      execute: vi.fn().mockResolvedValue({
        success: true, stepsCompleted: 1, totalSteps: 1,
        macroId: 'm1', version: 1, executionTimeMs: 50, selectorResolutions: []
      })
    };
    mockHttp = {
      post: vi.fn().mockResolvedValue({}),
      get: vi.fn().mockResolvedValue({ capabilities: [] })
    };

    executor = new CapabilityExecutor({
      cache: mockCache as CapabilityCache,
      macroRunner: mockRunner as MacroRunner,
      telemetry: {} as TelemetryReporter,
      httpClient: mockHttp as AIRHttpClient
    });
  });

  // --- Happy path ---
  it('executes a capability successfully and sends positive feedback', async () => {
    const result = await executor.execute({}, {
      capability: 'search', domain: 'test.com', params: {}
    });

    expect(result.success).toBe(true);
    expect(result.macroUsed).toBe(true);
    expect(result.macroId).toBe('m1');
    expect(result.fallbackUsed).toBe(false);
    expect(mockRunner.execute).toHaveBeenCalled();
    expect(mockHttp.post).toHaveBeenCalledWith(
      '/api/v1/sdk/feedback',
      expect.objectContaining({ success: true, macroId: 'm1' })
    );
  });

  // --- Capability not found ---
  it('returns capability_not_found when domain has no matching capability', async () => {
    const result = await executor.execute({}, {
      capability: 'nonexistent', domain: 'test.com', params: {}
    });

    expect(result.success).toBe(false);
    expect(result.macroUsed).toBe(false);
    expect(result.error).toBe('capability_not_found');
    expect(mockRunner.execute).not.toHaveBeenCalled();
  });

  // --- No macro available ---
  it('returns no_macro_available when capability has no macro', async () => {
    mockCap.macroAvailable = false;
    mockCap.macroId = undefined;
    mockCache.getCapabilities.mockResolvedValue([mockCap]);

    const result = await executor.execute({}, {
      capability: 'search', domain: 'test.com', params: {}
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('no_macro_available');
  });

  // --- Macro download failure ---
  it('returns macro_download_failed when cache returns null', async () => {
    mockCache.getMacro.mockResolvedValue(null);

    const result = await executor.execute({}, {
      capability: 'search', domain: 'test.com', params: {}
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('macro_download_failed');
  });

  // --- Macro execution failure ---
  it('sends negative feedback and activates fallback when macro fails', async () => {
    mockRunner.execute.mockResolvedValue({
      success: false, failedAtStep: 0, failedSelector: '#broken',
      stepsCompleted: 0, totalSteps: 1, executionTimeMs: 30, selectorResolutions: []
    });

    const result = await executor.execute({}, {
      capability: 'search', domain: 'test.com', params: {}
    });

    expect(result.success).toBe(false);
    expect(result.fallbackUsed).toBe(true);
    expect(result.error).toBe('macro_execution_failed');
    expect(mockHttp.post).toHaveBeenCalledWith(
      '/api/v1/sdk/feedback',
      expect.objectContaining({ success: false, failedAtStep: 0 })
    );
    // FallbackObserver should be active
    expect(executor.getFallbackObserver().isObserving).toBe(true);
    expect(executor.getFallbackObserver().failedMacroId).toBe('m1');
  });

  // --- Feedback error swallowed ---
  it('swallows feedback network errors without throwing', async () => {
    mockHttp.post.mockRejectedValue(new Error('Network offline'));

    // Should NOT throw
    const result = await executor.execute({}, {
      capability: 'search', domain: 'test.com', params: {}
    });

    expect(result.success).toBe(true);
  });

  // --- listCapabilities ---
  it('listCapabilities delegates to cache', async () => {
    const caps = await executor.listCapabilities('test.com');
    expect(mockCache.getCapabilities).toHaveBeenCalledWith('test.com');
    expect(caps).toHaveLength(1);
  });

  // --- searchCapabilities ---
  it('searchCapabilities calls the cloud search endpoint', async () => {
    const fakeCaps: Capability[] = [mockCap];
    mockHttp.get.mockResolvedValue({ capabilities: fakeCaps });

    const caps = await executor.searchCapabilities('flights');
    expect(mockHttp.get).toHaveBeenCalledWith('/api/v1/sdk/capabilities', { search: 'flights' });
    expect(caps).toHaveLength(1);
  });

  it('searchCapabilities returns empty on network error', async () => {
    mockHttp.get.mockRejectedValue(new Error('Offline'));

    const caps = await executor.searchCapabilities('flights');
    expect(caps).toEqual([]);
  });
});

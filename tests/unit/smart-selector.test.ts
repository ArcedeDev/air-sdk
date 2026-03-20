import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SmartSelectorResolver } from '../../src/core/smart-selector';
import { CapabilityCache } from '../../src/core/capability-cache';

describe('SmartSelectorResolver', () => {
  let resolver: SmartSelectorResolver;
  let mockCache: Partial<CapabilityCache>;
  let mockPage: any;

  beforeEach(() => {
    mockCache = {
      getSmartSelector: vi.fn(),
    };
    resolver = new SmartSelectorResolver(mockCache as CapabilityCache);
    
    mockPage = {
      $: vi.fn(),
      evaluate: vi.fn(),
    };
  });

  it('returns original selector when no smart selector exists', async () => {
    (mockCache.getSmartSelector as any).mockReturnValue(null);
    mockPage.$.mockResolvedValue(null); // original fails on page too

    const resolution = await resolver.resolve(mockPage, '#not-found', 'test.com');
    
    expect(resolution.usedSelector).toBe('#not-found');
    expect(resolution.attemptedSelectors).toContain('#not-found');
  });

  it('tries smart primary first and returns it if successful', async () => {
    (mockCache.getSmartSelector as any).mockReturnValue({
      primary: '#primary',
      fallbacks: ['.fallback'],
      semantic: []
    });

    mockPage.$.mockImplementation(async (sel: string) => sel === '#primary' ? {} : null);

    const resolution = await resolver.resolve(mockPage, '#original', 'test.com');
    
    expect(resolution.usedSelector).toBe('#primary');
    expect(resolution.attemptedSelectors).toEqual(['#primary']);
  });

  it('falls back through the chain if primary fails', async () => {
    (mockCache.getSmartSelector as any).mockReturnValue({
      primary: '#primary',
      fallbacks: ['.fb1', '.fb2'],
      semantic: ['[role="button"]']
    });

    // Only second fallback works
    mockPage.$.mockImplementation(async (sel: string) => sel === '.fb2' ? {} : null);

    const resolution = await resolver.resolve(mockPage, '#original', 'test.com');
    
    expect(resolution.usedSelector).toBe('.fb2');
    expect(resolution.attemptedSelectors).toEqual(['#primary', '.fb1', '.fb2']);
  });

  it('falls back to original if smart selectors all fail', async () => {
    (mockCache.getSmartSelector as any).mockReturnValue({
      primary: '#primary',
      fallbacks: ['.fb1'],
      semantic: []
    });

    // None work
    mockPage.$.mockResolvedValue(null);

    const resolution = await resolver.resolve(mockPage, '#original', 'test.com');
    
    expect(resolution.usedSelector).toBe('#original');
    expect(resolution.attemptedSelectors).toEqual(['#primary', '.fb1', '#original']);
  });

  it('discovers fallback selectors via evaluate', async () => {
    mockPage.evaluate.mockResolvedValue(['[data-testid="test"]', 'button']);

    const fallbacks = await resolver.discoverFallbacks(mockPage, '#btn');

    expect(fallbacks).toEqual(['[data-testid="test"]', 'button']);
    expect(mockPage.evaluate).toHaveBeenCalled();
  });

  it('calls dispose() on ElementHandle results to prevent memory leaks', async () => {
    (mockCache.getSmartSelector as any).mockReturnValue({
      primary: '#primary',
      fallbacks: [],
      semantic: [],
    });

    const disposeFn = vi.fn().mockResolvedValue(undefined);
    mockPage.$.mockResolvedValue({ dispose: disposeFn });

    const resolution = await resolver.resolve(mockPage, '#original', 'test.com');

    expect(resolution.usedSelector).toBe('#primary');
    expect(disposeFn).toHaveBeenCalledTimes(1);
  });

  it('handles dispose() throwing without propagating error', async () => {
    (mockCache.getSmartSelector as any).mockReturnValue({
      primary: '#primary',
      fallbacks: [],
      semantic: [],
    });

    const disposeFn = vi.fn().mockRejectedValue(new Error('dispose failed'));
    mockPage.$.mockResolvedValue({ dispose: disposeFn });

    // Should not throw
    const resolution = await resolver.resolve(mockPage, '#original', 'test.com');

    expect(resolution.usedSelector).toBe('#primary');
    expect(disposeFn).toHaveBeenCalledTimes(1);
  });
});

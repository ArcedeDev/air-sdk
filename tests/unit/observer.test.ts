import { expect, test, describe, vi } from 'vitest';
import { ActionObserver, methodNameToActionType, extractSelector, inferOutcome } from '../../src/core/observer';
import { PrivacyFilter } from '../../src/core/privacy-filter';

describe('ActionObserver Utilities', () => {
  test('methodNameToActionType maps accurately', () => {
    expect(methodNameToActionType('click')).toBe('click');
    expect(methodNameToActionType('goto')).toBe('navigate');
    expect(methodNameToActionType('fill')).toBe('fill');
    expect(methodNameToActionType('unknownMethod')).toBe('evaluate');
  });

  test('extractSelector maps correctly from args', () => {
    expect(extractSelector('click', ['#btn'])).toBe('#btn');
    expect(extractSelector('fill', ['input[name="user"]', 'john'])).toBe('input[name="user"]');
    expect(extractSelector('press', ['#input', 'Enter'])).toBe('#input');
    expect(extractSelector('goto', ['https://example.com'])).toBeUndefined();
  });

  test('inferOutcome correctly resolves session success state', () => {
    expect(inferOutcome([])).toBe('unknown');
    expect(inferOutcome([{ success: true } as any, { success: true } as any])).toBe('success');
    expect(inferOutcome([{ success: true } as any, { success: false } as any])).toBe('failure');
    expect(inferOutcome([{ success: false } as any, { success: true } as any])).toBe('partial');
  });
});

describe('ActionObserver', () => {
  const mockCache = { preload: vi.fn().mockResolvedValue(undefined) };
  const mockFilter = new PrivacyFilter();
  const mockOnFlush = vi.fn();
  const mockBrowserInfo = { framework: 'playwright' as const, frameworkVersion: '1', headless: true };

  test('wrapMethod calls original transparently and records action', async () => {
    const observer = new ActionObserver({
      capabilityCache: mockCache,
      privacyFilter: mockFilter,
      browserInfo: mockBrowserInfo,
      onFlush: mockOnFlush
    });

    const mockPage = {
      evaluate: vi.fn().mockResolvedValue({ tagName: 'BUTTON' })
    };

    const originalMethod = vi.fn().mockResolvedValue('expected_result');
    const wrapped = observer.wrapMethod('click', originalMethod, mockPage);

    const result = await wrapped('#submit-btn');
    expect(result).toBe('expected_result');
    expect(originalMethod).toHaveBeenCalledWith('#submit-btn');
    expect(observer.actionCount).toBe(1);

    // Should flush action when manually flushing
    observer['currentDomain'] = 'example.com';
    await observer.flush();

    expect(mockOnFlush).toHaveBeenCalled();
    const event = mockOnFlush.mock.calls[0][0];
    expect(event.domain).toBe('example.com');
    expect(event.actionSequence.length).toBe(1);
    expect(event.actionSequence[0].type).toBe('click');
    expect(event.actionSequence[0].selector).toBe('#submit-btn');
    // Values inherently REDACTED
    expect((event.actionSequence[0] as any).value).toBeUndefined();
  });

  test('error propagation works correctly', async () => {
    const observer = new ActionObserver({
      capabilityCache: mockCache,
      privacyFilter: mockFilter,
      browserInfo: mockBrowserInfo,
      onFlush: mockOnFlush
    });

    const error = new Error('Playwright failure');
    const originalMethod = vi.fn().mockRejectedValue(error);
    const wrapped = observer.wrapMethod('click', originalMethod, {});

    await expect(wrapped('#btn')).rejects.toThrow('Playwright failure');
    expect(observer.actionCount).toBe(1); // action recorded even on failure
  });

  test('navigation domain tracking works and triggers flush', async () => {
    const observer = new ActionObserver({
      capabilityCache: mockCache,
      privacyFilter: mockFilter,
      browserInfo: mockBrowserInfo,
      onFlush: mockOnFlush
    });

    mockOnFlush.mockClear();

    await observer.onNavigate('https://first.com/page');
    expect(observer.domain).toBe('first.com');
    expect(mockCache.preload).toHaveBeenCalledWith('first.com');

    // Add an action
    observer['actions'].push({ type: 'click', durationMs: 10, success: true, timestamp: 123 } as any);

    // Navigate to new domain -> should flush first.com
    await observer.onNavigate('https://second.com/home');
    expect(mockOnFlush).toHaveBeenCalledTimes(1);
    expect(mockOnFlush.mock.calls[0][0].domain).toBe('first.com');
    expect(observer.domain).toBe('second.com');
    expect(observer.actionCount).toBe(0);
  });

  test('records action even when DOM context capture throws', async () => {
    const onFlush = vi.fn();
    const observer = new ActionObserver({
      capabilityCache: mockCache,
      privacyFilter: mockFilter,
      browserInfo: mockBrowserInfo,
      onFlush,
    });

    const mockPage = {
      evaluate: vi.fn().mockRejectedValue(new Error('Execution context destroyed')),
    };

    const originalMethod = vi.fn().mockResolvedValue('ok');
    const wrapped = observer.wrapMethod('click', originalMethod, mockPage);

    const result = await wrapped('#btn');
    expect(result).toBe('ok');
    expect(observer.actionCount).toBe(1);
  });

  test('error propagates immediately even when DOM capture would fail', async () => {
    const onFlush = vi.fn();
    const observer = new ActionObserver({
      capabilityCache: mockCache,
      privacyFilter: mockFilter,
      browserInfo: mockBrowserInfo,
      onFlush,
    });

    // DOM capture will fail — but this should NOT delay the error propagation
    const mockPage = {
      evaluate: vi.fn().mockRejectedValue(new Error('Page navigated')),
    };

    const originalMethod = vi.fn().mockRejectedValue(new Error('Click failed'));
    const wrapped = observer.wrapMethod('click', originalMethod, mockPage);

    await expect(wrapped('#btn')).rejects.toThrow('Click failed');
    expect(observer.actionCount).toBe(1);
  });
});

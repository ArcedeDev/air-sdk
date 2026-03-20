import { expect, test, describe } from 'vitest';
import { PrivacyFilter } from '../../src/core/privacy-filter';
import { RecordedAction, TelemetryEvent } from '../../src/core/types';

describe('PrivacyFilter', () => {
  const filter = new PrivacyFilter();

  describe('filterAction', () => {
    test('drops value, url, key, and timestamp', () => {
      const action: RecordedAction = {
        type: 'fill',
        selector: '#username',
        value: 'john@example.com',
        url: 'https://example.com/login',
        key: 'Enter',
        success: true,
        durationMs: 150,
        timestamp: 16788888888,
      };

      const filtered = filter.filterAction(action);
      
      expect(filtered.type).toBe('fill');
      expect(filtered.selector).toBe('#username');
      expect(filtered.success).toBe(true);
      expect(filtered.durationMs).toBe(150);
      
      expect((filtered as any).value).toBeUndefined();
      expect((filtered as any).url).toBeUndefined();
      expect((filtered as any).key).toBeUndefined();
      expect((filtered as any).timestamp).toBeUndefined();
    });

    test('sanitizes selectors containing PII', () => {
      const action: RecordedAction = {
        type: 'click',
        selector: 'button[aria-label="Send to john@example.com"]',
        success: true,
        durationMs: 40,
        timestamp: 123
      };
      const filtered = filter.filterAction(action);
      expect(filtered.selector).toBe('button[aria-label="[REDACTED]"]');
    });
    
    test('sanitizes ariaLabel in domContext containing PII', () => {
      const action: RecordedAction = {
        type: 'click',
        success: true,
        durationMs: 40,
        timestamp: 123,
        domContext: {
          tagName: 'DIV',
          ariaLabel: 'Phone: 1234567890'
        }
      };
      const filtered = filter.filterAction(action);
      expect(filtered.domContext?.ariaLabel).toBe('[REDACTED]');
    });
  });

  describe('sanitizeUrl', () => {
    test('strips query parameters', () => {
      const res = filter.sanitizeUrl('https://kayak.com/flights?q=tokyo');
      expect(res.domain).toBe('kayak.com');
      expect(res.path).toBe('/flights');
    });

    test('handles path only', () => {
      const res = filter.sanitizeUrl('/flights?q=tokyo');
      expect(res.path).toBe('/flights');
    });
  });

  describe('sanitizeSelector', () => {
    test('redacts email in attribute', () => {
      expect(filter.sanitizeSelector('input[value="john@email.com"]')).toBe('input[value="[REDACTED]"]');
    });
    test('redacts >=5 consecutive digits', () => {
      expect(filter.sanitizeSelector('[data-id="12345"]')).toBe('[data-id="[REDACTED]"]');
      expect(filter.sanitizeSelector('[data-id="1234"]')).toBe('[data-id="1234"]');
    });
    test('redacts >40 chars', () => {
      const long = 'a'.repeat(41);
      expect(filter.sanitizeSelector(`[title="${long}"]`)).toBe('[title="[REDACTED]"]');
    });
    test('leaves clean selectors alone', () => {
      expect(filter.sanitizeSelector('#destination')).toBe('#destination');
      expect(filter.sanitizeSelector('.search-btn')).toBe('.search-btn');
      expect(filter.sanitizeSelector('input[type="submit"]')).toBe('input[type="submit"]');
      expect(filter.sanitizeSelector('[data-testid="submit-btn"]')).toBe('[data-testid="submit-btn"]');
      expect(filter.sanitizeSelector('div[class^="styles_container"]')).toBe('div[class^="styles_container"]');
    });
  });

  describe('filterEvent', () => {
    test('filters entire event structure', () => {
      const event: Partial<TelemetryEvent> = {
        domain: 'example.com',
        path: '/search?query=secret',
        actionSequence: [
          {
            type: 'fill',
            selector: 'input[name="email"]',
            success: true,
            durationMs: 10,
            value: 'hello@world.com',
            timestamp: 123
          } as any
        ],
        sessionOutcome: 'success',
        executionTimeMs: 10,
        timestamp: '2023-01-01',
        browserInfo: { framework: 'playwright', frameworkVersion: '1', headless: true }
      };

      const filtered = filter.filterEvent(event);
      expect(filtered.domain).toBe('example.com');
      expect(filtered.path).toBe('/search');
      expect((filtered.actionSequence[0] as any).value).toBeUndefined();
      expect(filtered.actionSequence[0].type).toBe('fill');
    });
  });
});

import { RecordedAction, TelemetryAction, TelemetryEvent } from './types';

export class PrivacyFilter {
  // Filter a single recorded action (strip PII)
  filterAction(action: RecordedAction): TelemetryAction {
    const { value, url, key, timestamp, selector, fallbackSelectors, domContext, ...rest } = action;

    const filtered: TelemetryAction = { ...rest };

    if (selector) {
      filtered.selector = this.sanitizeSelector(selector);
    }
    
    if (fallbackSelectors && fallbackSelectors.length > 0) {
      filtered.fallbackSelectors = fallbackSelectors.map((s) => this.sanitizeSelector(s));
    }

    if (domContext) {
      const safeContext = { ...domContext };
      if (safeContext.ariaLabel) {
        safeContext.ariaLabel = this.sanitizeAriaLabel(safeContext.ariaLabel);
      }
      filtered.domContext = safeContext;
    }

    return filtered;
  }

  // Filter a complete telemetry event
  filterEvent(event: Partial<TelemetryEvent>): TelemetryEvent {
    const filteredEvent = { ...event } as TelemetryEvent;
    
    if (event.actionSequence) {
      filteredEvent.actionSequence = event.actionSequence.map((a: any) => this.filterAction(a));
    }
    
    if (event.recoverySequence) {
      filteredEvent.recoverySequence = event.recoverySequence.map((a: any) => this.filterAction(a));
    }

    if (event.path) {
      filteredEvent.path = this.sanitizeUrl(event.path).path;
    }
    
    if (event.domain) {
      filteredEvent.domain = this.sanitizeUrl(`https://${event.domain}`).domain;
    }

    return filteredEvent;
  }

  // Strip query strings from URLs, keep path only
  sanitizeUrl(urlStr: string): { domain: string; path: string } {
    try {
      const isRelative = urlStr.startsWith('/');
      // Use dummy base to parse paths natively
      const parsed = new URL(isRelative ? `https://dummy.com${urlStr}` : urlStr);
      return { 
        domain: isRelative ? '' : parsed.hostname, 
        path: parsed.pathname 
      };
    } catch {
      // Fallback for completely malformed URLs
      const split = urlStr.split('?')[0].split('#')[0];
      return { domain: '', path: split };
    }
  }

  // Strip potential PII from selector
  sanitizeSelector(selector: string): string {
    // Regex matches [attr="value"] or [attr='value'] or [attr=value] supporting operators =, *=, ^=, $=, ~=, |=
    return selector.replace(/\[([a-zA-Z0-9_-]+)\s*([*^$|~]?=)\s*(["']?)(.*?)\3\]/g, (match, attr, op, _quote, val) => {
      // Check for PII heuristics: email (@), digits >= 5, length > 40
      if (val.includes('@') || /\d{5,}/.test(val) || val.length > 40) {
        return `[${attr}${op}"[REDACTED]"]`;
      }
      return match;
    });
  }

  private sanitizeAriaLabel(label: string): string {
    if (label.includes('@') || /\d{5,}/.test(label) || label.length > 40) {
      return '[REDACTED]';
    }
    return label;
  }
}

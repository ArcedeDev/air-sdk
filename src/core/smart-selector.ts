import type { SelectorResolution } from './types';
import type { CapabilityCache } from './capability-cache';

export class SmartSelectorResolver {
  constructor(private cache: CapabilityCache) {}

  /**
   * Resolve a selector: try smart alternatives first, fall back to original.
   * Tests elements with page.$(candidate) and returns the first hitting selector.
   */
  async resolve(
    page: any, // Playwright Page | Puppeteer Page
    selector: string,
    domain: string
  ): Promise<SelectorResolution> {
    const startTime = Date.now();
    const smart = this.cache.getSmartSelector(domain, selector);
    const attemptedSelectors: string[] = [];

    const testSelector = async (candidate: string): Promise<boolean> => {
      attemptedSelectors.push(candidate);
      try {
        const result = await page.$(candidate);
        if (result !== null) {
          // Dispose handle to prevent memory leaks in Playwright/Puppeteer
          if (typeof result.dispose === 'function') {
            await result.dispose().catch(() => {});
          }
          return true;
        }
        return false;
      } catch (err) {
        return false;
      }
    };

    let resolvedSelector = selector;
    let found = false;

    if (smart) {
      if (smart.primary && await testSelector(smart.primary)) {
        resolvedSelector = smart.primary;
        found = true;
      }

      if (!found && smart.fallbacks) {
        for (const fb of smart.fallbacks) {
          if (await testSelector(fb)) {
            resolvedSelector = fb;
            found = true;
            break;
          }
        }
      }

      if (!found && smart.semantic) {
        for (const semantic of smart.semantic) {
          if (await testSelector(semantic)) {
            resolvedSelector = semantic;
            found = true;
            break;
          }
        }
      }
    }

    if (!found) {
      if (!attemptedSelectors.includes(selector)) {
        await testSelector(selector); 
      }
      resolvedSelector = selector;
    }

    return {
      usedSelector: resolvedSelector,
      attemptedSelectors,
      resolutionTimeMs: Date.now() - startTime
    };
  }

  /**
   * Discover fallback selectors for an element (after action succeeds).
   * Runs in-page evaluation to discover structural resilience paths.
   */
  async discoverFallbacks(page: any, selector: string): Promise<string[]> {
    try {
      const fallbacks = await page.evaluate((sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return [];
        
        const alternatives: string[] = [];
        
        // 1. Data test ID
        const testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id');
        if (testId) alternatives.push(`[data-testid="${testId}"]`, `[data-test-id="${testId}"]`);
        
        // 2. Aria label
        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel) alternatives.push(`[${el.tagName.toLowerCase()}][aria-label="${ariaLabel}"]`);
        
        // 3. Role (framework-agnostic — no Playwright-specific pseudo-selectors)
        const role = el.getAttribute('role');
        if (role) {
          alternatives.push(`[role="${role}"]`);
          // If there's also a name attribute, combine for specificity
          const name = el.getAttribute('name');
          if (name) alternatives.push(`[role="${role}"][name="${name}"]`);
        }

        // 4. CSS Path (with classes)
        let current: Element | null = el;
        const cssPathSteps: string[] = [];
        while (current && current.tagName !== 'HTML') {
          let step = current.tagName.toLowerCase();
          if (current.id) {
            step += '#' + current.id;
            cssPathSteps.unshift(step);
            break; // IDs are unique, stop here
          } else {
            // Append class names if available
            if (current.className && typeof current.className === 'string') {
              const classes = current.className.split(' ').filter(c => c.trim().length > 0);
              if (classes.length > 0) {
                step += '.' + classes.join('.');
              }
            }
            let nth = 1;
            let sibling = current.previousElementSibling;
            while (sibling) {
              if (sibling.tagName === current.tagName) nth++;
              sibling = sibling.previousElementSibling;
            }
            if (nth > 1) {
              step += ':nth-of-type(' + nth + ')';
            }
          }
          cssPathSteps.unshift(step);
          current = current.parentElement;
        }
        if (cssPathSteps.length > 0) {
          alternatives.push(cssPathSteps.join(' > '));
        }

        // 5. XPath (simplified)
        let xpathCurrent: Node | null = el;
        const xpathSteps: string[] = [];
        while (xpathCurrent && xpathCurrent.nodeType === 1) { // ELEMENT_NODE
          const elem = xpathCurrent as Element;
          let step = elem.tagName.toLowerCase();
          if (elem.id) {
            step += '[@id="' + elem.id + '"]';
            xpathSteps.unshift(step);
            break; // IDs are unique
          } else {
            let index = 1;
            let sibling = xpathCurrent.previousSibling;
            while (sibling) {
              if (sibling.nodeType === 1 && (sibling as Element).tagName === elem.tagName) {
                index++;
              }
              sibling = sibling.previousSibling;
            }
            if (index > 1) step += '[' + index + ']';
          }
          xpathSteps.unshift(step);
          xpathCurrent = xpathCurrent.parentNode;
        }
        if (xpathSteps.length > 0) {
          alternatives.push('//' + xpathSteps.join('/'));
        }

        return Array.from(new Set(alternatives)).filter(s => s !== sel);
      }, selector);

      return fallbacks || [];
    } catch (err) {
      return [];
    }
  }
}

import { describe, it, expect, beforeEach } from 'vitest';
import { FallbackObserver } from '../../src/execute/fallback-observer';
import type { TelemetryAction } from '../../src/core/types';

describe('FallbackObserver', () => {
  let observer: FallbackObserver;

  beforeEach(() => {
    observer = new FallbackObserver();
  });

  it('starts in non-observing state', () => {
    expect(observer.isObserving).toBe(false);
    expect(observer.failedMacroId).toBeUndefined();
    expect(observer.failedAtStep).toBeUndefined();
    expect(observer.actionCount).toBe(0);
  });

  it('records actions while observing', () => {
    observer.startObserving({}, 'macro-1', 3);

    expect(observer.isObserving).toBe(true);
    expect(observer.failedMacroId).toBe('macro-1');
    expect(observer.failedAtStep).toBe(3);

    const action: TelemetryAction = {
      type: 'click',
      selector: '#retry-btn',
      success: true,
      durationMs: 50,
    };
    observer.recordAction(action);
    expect(observer.actionCount).toBe(1);

    observer.recordAction({ ...action, selector: '#alt-btn' });
    expect(observer.actionCount).toBe(2);
  });

  it('ignores actions when not observing', () => {
    const action: TelemetryAction = {
      type: 'click',
      selector: '#btn',
      success: true,
      durationMs: 10,
    };
    observer.recordAction(action);
    expect(observer.actionCount).toBe(0);
  });

  it('returns recovery actions on stop and resets state', () => {
    observer.startObserving({}, 'macro-2', 1);

    observer.recordAction({ type: 'click', selector: '#a', success: true, durationMs: 10 });
    observer.recordAction({ type: 'fill', selector: '#b', success: true, durationMs: 20 });

    const actions = observer.stopObserving();

    expect(actions).toHaveLength(2);
    expect(actions[0].selector).toBe('#a');
    expect(actions[1].selector).toBe('#b');
    expect(observer.isObserving).toBe(false);
    expect(observer.actionCount).toBe(0);
  });

  it('returns a copy of actions, not a reference', () => {
    observer.startObserving({}, 'macro-3', 0);
    observer.recordAction({ type: 'click', selector: '#x', success: true, durationMs: 5 });

    const actions = observer.stopObserving();
    actions.push({ type: 'fill', selector: '#y', success: true, durationMs: 5 });

    // Internal state should not be affected
    expect(observer.actionCount).toBe(0);
  });

  it('resets previous actions when startObserving is called again', () => {
    observer.startObserving({}, 'macro-4', 2);
    observer.recordAction({ type: 'click', selector: '#old', success: true, durationMs: 10 });
    expect(observer.actionCount).toBe(1);

    // Start observing for a different macro failure
    observer.startObserving({}, 'macro-5', 0);
    expect(observer.actionCount).toBe(0);
    expect(observer.failedMacroId).toBe('macro-5');
    expect(observer.failedAtStep).toBe(0);
  });

  it('handles step 0 failure correctly', () => {
    observer.startObserving({}, 'macro-6', 0);
    expect(observer.failedAtStep).toBe(0);
    expect(observer.isObserving).toBe(true);
  });
});

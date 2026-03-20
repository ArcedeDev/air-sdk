import type { TelemetryAction } from '../core/types';

/**
 * Records actions taken after a macro execution fails,
 * for quality improvement purposes.
 */
export class FallbackObserver {
  private _observing = false;
  private _failedMacroId?: string;
  private _failedAtStep?: number;
  private _recoveryActions: TelemetryAction[] = [];

  /**
   * Start watching for recovery actions after a macro failure.
   * Resets any previously captured actions.
   */
  startObserving(page: any, failedMacroId: string, failedAtStep: number): void {
    this._observing = true;
    this._failedMacroId = failedMacroId;
    this._failedAtStep = failedAtStep;
    this._recoveryActions = [];
  }

  /**
   * Stop observing and return the recovery sequence.
   * Resets internal state so the observer can be reused.
   */
  stopObserving(): TelemetryAction[] {
    this._observing = false;
    const actions = [...this._recoveryActions];
    this._recoveryActions = [];
    return actions;
  }

  /** Whether currently observing fallback actions */
  get isObserving(): boolean {
    return this._observing;
  }

  /** The macro ID that failed (available while observing) */
  get failedMacroId(): string | undefined {
    return this._failedMacroId;
  }

  /** The step index where the macro failed (available while observing) */
  get failedAtStep(): number | undefined {
    return this._failedAtStep;
  }

  /** Number of recovery actions recorded so far */
  get actionCount(): number {
    return this._recoveryActions.length;
  }

  /**
   * Record an action taken by the developer's agent.
   * No-op if not currently observing.
   */
  recordAction(action: TelemetryAction): void {
    if (this._observing) {
      this._recoveryActions.push(action);
    }
  }
}

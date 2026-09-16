/**
 * Decides what should happen when the browser releases pointer lock while
 * Walk Mode is `walking` (spec §7.6). Browsers use ESC to release pointer
 * lock and usually do NOT deliver that keydown to the page, so this can't
 * simply listen for an Escape keydown - it has to infer intent from
 * whether the page also lost focus/visibility around the same time:
 * losing focus/visibility (or a recent blur) means alt-tab, a window
 * switch, or an OS dialog, not a deliberate exit, so Walk Mode pauses
 * instead of exiting.
 */
export interface LockLossContext {
  hasFocus: boolean;
  hidden: boolean;
  blurredWithinMs: boolean;
}

export type LockLossOutcome = 'pause' | 'exit';

export function lockLossClassifier(ctx: LockLossContext): LockLossOutcome {
  if (!ctx.hasFocus || ctx.hidden || ctx.blurredWithinMs) return 'pause';
  return 'exit';
}

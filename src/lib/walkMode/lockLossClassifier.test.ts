import { describe, it, expect } from 'vitest';
import { lockLossClassifier } from './lockLossClassifier';

describe('lockLossClassifier', () => {
  it('exits when the page is focused, visible, and has not recently blurred (deliberate ESC)', () => {
    expect(lockLossClassifier({ hasFocus: true, hidden: false, blurredWithinMs: false })).toBe('exit');
  });

  it('pauses when the tab is hidden', () => {
    expect(lockLossClassifier({ hasFocus: true, hidden: true, blurredWithinMs: false })).toBe('pause');
  });

  it('pauses when the page has lost focus', () => {
    expect(lockLossClassifier({ hasFocus: false, hidden: false, blurredWithinMs: false })).toBe('pause');
  });

  it('pauses when a blur happened within the recent window', () => {
    expect(lockLossClassifier({ hasFocus: true, hidden: false, blurredWithinMs: true })).toBe('pause');
  });
});

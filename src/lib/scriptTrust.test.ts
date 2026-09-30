import { describe, expect, it } from 'vitest';
import { assertScriptExecutionAllowed, canExecuteDeveloperScript } from './utils';

describe('developer script execution trust', () => {
  it('allows only scripts owned by the signed-in user', () => {
    expect(canExecuteDeveloperScript('user-a', 'user-a')).toBe(true);
    expect(canExecuteDeveloperScript('user-b', 'user-a')).toBe(false);
    expect(canExecuteDeveloperScript('user-a', undefined)).toBe(false);
  });

  it('rejects shared or unauthenticated direct execution', () => {
    expect(() => assertScriptExecutionAllowed('user-b', 'user-a')).toThrow(/Shared scripts cannot run directly/);
    expect(() => assertScriptExecutionAllowed('user-a', undefined)).toThrow(/Shared scripts cannot run directly/);
    expect(() => assertScriptExecutionAllowed('user-a', 'user-a')).not.toThrow();
  });
});

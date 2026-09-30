import { describe, expect, it } from 'vitest';
import { createPasswordGate, isLegacyPlaintextGate, verifyPasswordGate } from './passwordGate';

describe('shared model password gates', () => {
  it('stores a one-way PBKDF2 record rather than plaintext', async () => {
    const gate = await createPasswordGate('correct horse battery staple', {
      iterations: 100_000,
      salt: new Uint8Array(16).fill(7),
    });
    expect(gate).not.toHaveProperty('password');
    expect(gate.hash).not.toContain('correct horse');
    expect(await verifyPasswordGate('correct horse battery staple', gate)).toBe(true);
    expect(await verifyPasswordGate('wrong', gate)).toBe(false);
  });

  it('can verify legacy plaintext gates during migration', async () => {
    const legacy = { password: 'old-password' };
    expect(isLegacyPlaintextGate(legacy)).toBe(true);
    expect(await verifyPasswordGate('old-password', legacy)).toBe(true);
    expect(await verifyPasswordGate('wrong', legacy)).toBe(false);
  });
});

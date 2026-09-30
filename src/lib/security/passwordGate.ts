export interface PasswordGateRecord {
  algorithm: 'PBKDF2-SHA256';
  salt: string;
  hash: string;
  iterations: number;
  version: 1;
}

const DEFAULT_ITERATIONS = 210_000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function createPasswordGate(
  password: string,
  options: { iterations?: number; salt?: Uint8Array } = {},
): Promise<PasswordGateRecord> {
  if (!password) throw new Error('A shared-model password cannot be empty.');
  const iterations = Math.max(100_000, Math.round(options.iterations ?? DEFAULT_ITERATIONS));
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, iterations);
  return {
    algorithm: 'PBKDF2-SHA256',
    salt: bytesToBase64(salt),
    hash: bytesToBase64(hash),
    iterations,
    version: 1,
  };
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyPasswordGate(password: string, record: unknown): Promise<boolean> {
  if (!record || typeof record !== 'object') return false;
  const gate = record as Partial<PasswordGateRecord> & { password?: unknown };

  // Temporary backward compatibility for pre-hash gate documents. The next
  // time the owner changes/re-saves the password it is migrated to PBKDF2.
  if (typeof gate.password === 'string') return password === gate.password;

  if (
    gate.algorithm !== 'PBKDF2-SHA256'
    || gate.version !== 1
    || typeof gate.salt !== 'string'
    || typeof gate.hash !== 'string'
    || typeof gate.iterations !== 'number'
  ) return false;

  try {
    const actual = await derive(password, base64ToBytes(gate.salt), gate.iterations);
    return equalBytes(actual, base64ToBytes(gate.hash));
  } catch {
    return false;
  }
}

export function isLegacyPlaintextGate(record: unknown): boolean {
  return Boolean(record && typeof record === 'object' && typeof (record as { password?: unknown }).password === 'string');
}

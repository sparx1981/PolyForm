import { createHash } from 'node:crypto';
import type { ImporterConfig } from './types';

const TRANSIENT = new Set([429, 500, 502, 503, 504]);
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class PolyHavenApi {
  private nextRequestAt = 0;
  constructor(private readonly config: ImporterConfig) {}

  async get(path: string): Promise<unknown> {
    const url = new URL(path, this.config.apiBaseUrl);
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      const delay = Math.max(0, this.nextRequestAt - Date.now());
      if (delay) await wait(delay);
      this.nextRequestAt = Date.now() + this.config.requestPacingMs;
      try {
        const userAgent = this.config.operatorContact && !this.config.userAgent.includes(this.config.operatorContact)
          ? `${this.config.userAgent} ${this.config.operatorContact}` : this.config.userAgent;
        const response = await fetch(url, { headers: { 'User-Agent': userAgent } });
        if (response.ok) return response.json();
        if (!TRANSIENT.has(response.status)) throw new Error(`Poly Haven ${response.status}: ${url}`);
        const retryAfter = Number(response.headers.get('retry-after')) * 1000;
        await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : this.backoff(attempt));
      } catch (error) {
        if (attempt === this.config.maxRetries || (error instanceof Error && error.message.startsWith('Poly Haven 4'))) throw error;
        await wait(this.backoff(attempt));
      }
    }
    throw new Error(`Poly Haven request exhausted retries: ${url}`);
  }

  private backoff(attempt: number): number {
    return Math.min(30_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
  }
}

export function sha256Json(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function mapConcurrent<T, R>(values: T[], concurrency: number, task: (value: T) => Promise<R>): Promise<R[]> {
  const result = new Array<R>(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++;
      result[index] = await task(values[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return result;
}

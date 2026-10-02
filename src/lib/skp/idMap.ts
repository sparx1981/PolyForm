/**
 * A map from non-negative whole numbers (SketchUp entity ids) to small integers, kept in two typed arrays.
 * A JavaScript Map costs tens of bytes per entry and puts pressure on the garbage collector; this costs 12.
 */
export class IdMap {
  private keys: Float64Array;
  private vals: Int32Array;
  private mask: number;
  size = 0;

  constructor(capacity = 16) {
    const cap = IdMap.capacityFor(capacity);
    this.keys = new Float64Array(cap).fill(-1);
    this.vals = new Int32Array(cap);
    this.mask = cap - 1;
  }

  private static capacityFor(entries: number): number {
    let cap = 16;
    while (cap < entries * 2) cap *= 2;
    return cap;
  }

  private static hash(key: number): number {
    const lo = key >>> 0;
    const hi = Math.floor(key / 4294967296) >>> 0;
    let h = Math.imul(lo ^ Math.imul(hi, 0x85ebca6b), 0x9e3779b1);
    h ^= h >>> 15;
    return h;
  }

  /** The value stored for `key`, or -1. */
  get(key: number): number {
    const keys = this.keys;
    let i = IdMap.hash(key) & this.mask;
    for (;;) {
      const k = keys[i];
      if (k === key) return this.vals[i];
      if (k === -1) return -1;
      i = (i + 1) & this.mask;
    }
  }

  /** Stores `value` for `key` and returns the value it replaced, or -1. */
  set(key: number, value: number): number {
    if ((this.size + 1) * 2 > this.keys.length) this.rehash(this.keys.length * 2);
    const keys = this.keys;
    let i = IdMap.hash(key) & this.mask;
    for (;;) {
      const k = keys[i];
      if (k === key) {
        const previous = this.vals[i];
        this.vals[i] = value;
        return previous;
      }
      if (k === -1) {
        keys[i] = key;
        this.vals[i] = value;
        this.size++;
        return -1;
      }
      i = (i + 1) & this.mask;
    }
  }

  clear(): void {
    if (this.size === 0) return;
    if (this.keys.length > 1024) {
      this.keys = new Float64Array(16).fill(-1);
      this.vals = new Int32Array(16);
      this.mask = 15;
    } else {
      this.keys.fill(-1);
    }
    this.size = 0;
  }

  private rehash(capacity: number): void {
    const oldKeys = this.keys;
    const oldVals = this.vals;
    this.keys = new Float64Array(capacity).fill(-1);
    this.vals = new Int32Array(capacity);
    this.mask = capacity - 1;
    for (let j = 0; j < oldKeys.length; j++) {
      const key = oldKeys[j];
      if (key === -1) continue;
      let i = IdMap.hash(key) & this.mask;
      while (this.keys[i] !== -1) i = (i + 1) & this.mask;
      this.keys[i] = key;
      this.vals[i] = oldVals[j];
    }
  }
}

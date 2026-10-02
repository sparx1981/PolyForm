export type CloudQualityLevel = 'low' | 'medium' | 'high';
export const CLOUD_LEVELS: readonly CloudQualityLevel[] = ['low', 'medium', 'high'];

/**
 * Picks the cloud quality for "Auto" from how fast frames actually arrive.
 *
 * Frame times cannot show spare GPU headroom (a screen refresh caps them), so it starts cautiously, steps down when
 * frames stay slow, and tries one level up only after a long smooth stretch. If that try is slow it steps back and
 * remembers not to go that high again.
 */
export class CloudQualityGovernor {
  level: number;
  /** Highest level worth trying; lowered whenever a level proves too slow. */
  cap: number;
  private time = 0; private frames = 0; private settle: number; private smooth = 0;
  constructor(start: CloudQualityLevel, private readonly options = { slowFps: 24, smoothFps: 54, window: 1.5, smoothWindows: 6, settleSeconds: 2.5, maxLevel: 2 }) {
    this.level = CLOUD_LEVELS.indexOf(start);
    this.cap = options.maxLevel;
    this.settle = options.settleSeconds;
  }
  get quality(): CloudQualityLevel { return CLOUD_LEVELS[this.level]!; }

  /** Feed each frame's duration in seconds; returns true when the level changed. */
  update(delta: number): boolean {
    // A hidden tab or a long stall says nothing about cloud cost.
    if (!(delta > 0) || delta > 0.5) { this.time = 0; this.frames = 0; return false; }
    if (this.settle > 0) { this.settle -= delta; return false; }
    this.time += delta; this.frames++;
    if (this.time < this.options.window) return false;
    const fps = this.frames / this.time;
    this.time = 0; this.frames = 0;
    if (fps < this.options.slowFps) {
      this.smooth = 0;
      if (this.level > 0) { this.cap = Math.min(this.cap, this.level - 1); this.level--; this.settle = this.options.settleSeconds; return true; }
      return false;
    }
    this.smooth = fps >= this.options.smoothFps ? this.smooth + 1 : 0;
    if (this.smooth >= this.options.smoothWindows && this.level < this.cap) {
      this.level++; this.smooth = 0; this.settle = this.options.settleSeconds; return true;
    }
    return false;
  }
}

/** First guess before any frames are measured: phones start low, everything else medium. */
export function startingCloudQuality(viewportWidth: number): CloudQualityLevel {
  return viewportWidth < 768 ? 'low' : 'medium';
}

// A tiny published value so the Beta lab can say what Auto chose, without touching app state.
const listeners = new Set<() => void>();
let current: CloudQualityLevel = 'low';
export function publishCloudQuality(level: CloudQualityLevel): void { if (level !== current) { current = level; listeners.forEach(l => l()); } }
export const getCloudQuality = () => current;
export function subscribeCloudQuality(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

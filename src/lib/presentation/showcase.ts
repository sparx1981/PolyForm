import { playBuild, playStages, presentation, STAGE_PLAY_SECONDS } from './store';

/**
 * The one-click showcase: the model builds itself up, splits into floors, turns see-through and
 * is sliced open, all while the camera circles it. Made for recording short clips to post.
 */
export interface ShowcaseOptions {
  /** Places the camera on a flattering three-quarter view. */
  frame: () => void;
  /** Turns the camera's slow orbit on or off. */
  orbit: (on: boolean) => void;
  signal: AbortSignal;
}

const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) return reject(new DOMException('Stopped', 'AbortError'));
  const t = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Stopped', 'AbortError')); }, { once: true });
});

async function untilBuilt(signal: AbortSignal) {
  while (presentation.get().buildPlaying) await wait(100, signal);
}

async function untilStaged(signal: AbortSignal) {
  while (presentation.get().stagePlaying) await wait(100, signal);
}

export const SHOWCASE_STEPS = ['Stages', 'Evening', 'Build', 'Explode', 'X-ray', 'Cut', 'Finish'] as const;

export async function runShowcase({ frame, orbit, signal }: ShowcaseOptions, onStep?: (step: typeof SHOWCASE_STEPS[number]) => void) {
  const s0 = presentation.get();
  presentation.reset(true);
  frame();
  orbit(true);
  try {
    // From a pencil sketch to the finished house, then the sun goes down.
    onStep?.('Stages');
    playStages();
    await wait(STAGE_PLAY_SECONDS * 500, signal);
    await untilStaged(signal);
    await wait(900, signal);
    onStep?.('Evening');
    presentation.set({ dusk: true });
    await wait(3500, signal);
    presentation.set({ dusk: false });
    await wait(1500, signal);

    onStep?.('Build');
    presentation.set({ buildSeconds: Math.max(5, s0.buildSeconds) });
    playBuild();
    await untilBuilt(signal);
    await wait(900, signal);

    if (presentation.get().storeys > 0) {
      onStep?.('Explode');
      presentation.set({ explode: 1 });
      await wait(3200, signal);
      onStep?.('X-ray');
      presentation.set({ xray: true });
      await wait(2800, signal);
      presentation.set({ xray: false, explode: 0 });
      await wait(1800, signal);

      onStep?.('Cut');
      const b = presentation.get().bounds;
      presentation.set({ cut: 'plan', cutAt: b ? Math.min(b.max[1], b.min[1] + 1.3) : 1.3 });
      await wait(3200, signal);
      presentation.set({ cut: 'off' });
    }
    onStep?.('Finish');
    await wait(1500, signal);
  } finally {
    orbit(false);
    presentation.set({ buildPlaying: false, build: 1, stagePlaying: false, stage: 3, dusk: false });
  }
}

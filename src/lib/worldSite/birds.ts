/**
 * PolyForm — World View: the two flocks of birds that fly over an imported site when Cars / People /
 * Birds is on. One is a small flock of birds wheeling round the site, the other a line of geese
 * crossing it in a V now and then. Everything is worked out from the time alone (no stored state), so
 * the flocks are the same wherever the animation is drawn.
 */

export interface Bird { x: number; y: number; z: number; yaw: number; pitch: number; bank: number; phase: number; visible: boolean }

function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** How many birds each flock has for a level of activity (fewer on phones). */
export function flockSizes(level: 'quiet' | 'normal' | 'busy', small = false): { wheeling: number; geese: number } {
  const base = level === 'quiet' ? { wheeling: 14, geese: 5 } : level === 'busy' ? { wheeling: 40, geese: 11 } : { wheeling: 26, geese: 7 };
  return small ? { wheeling: Math.ceil(base.wheeling / 2), geese: base.geese } : base;
}

/** A small flock of birds wheeling over the site in a loop, each a little behind the one before. */
export function wheelingFlock(t: number, size: number, count: number): Bird[] {
  const radius = Math.max(15, size * 0.28);
  const centre = (time: number) => ({
    x: Math.cos(time * 0.09) * radius,
    z: Math.sin(time * 0.18) * radius * 0.6,
    y: 30 + Math.sin(time * 0.13) * 6,
  });
  const at = (i: number, time: number) => {
    const lag = i * 0.05 + hash(i) * 0.6;
    const c = centre(time - lag);
    const phi = hash(i + 50) * Math.PI * 2, r = 2 + hash(i + 90) * 6;
    return {
      x: c.x + Math.cos(phi + time * 0.6) * r,
      y: c.y + Math.sin(phi * 2 + time * 0.8) * 2.4,
      z: c.z + Math.sin(phi + time * 0.6) * r,
    };
  };
  return Array.from({ length: count }, (_, i) => {
    const p = at(i, t), q = at(i, t + 0.12);
    const dx = q.x - p.x, dz = q.z - p.z, dy = q.y - p.y;
    const yaw = Math.atan2(dx, dz);
    const turn = Math.atan2(at(i, t + 0.4).x - q.x, at(i, t + 0.4).z - q.z) - yaw;
    return { ...p, yaw, pitch: -Math.atan2(dy, Math.hypot(dx, dz)), bank: Math.max(-0.6, Math.min(0.6, -Math.atan2(Math.sin(turn), Math.cos(turn)) * 3)), phase: hash(i + 7) * 6.28, visible: true };
  });
}

/** Geese in a V crossing the site, then a pause, then another pass from a different direction. */
export function gooseFlock(t: number, size: number, count: number): Bird[] {
  const speed = 11;
  const span = size * 1.5 + 80;
  const flight = span / speed, pause = 14;
  const pass = Math.floor(t / (flight + pause));
  const local = t - pass * (flight + pause);
  const inFlight = local < flight;
  const bearing = hash(pass + 3) * Math.PI * 2;
  const side = (hash(pass + 11) - 0.5) * size * 0.5;
  const fx = Math.sin(bearing), fz = Math.cos(bearing); // heading
  const lx = -fz, lz = fx; // to the leader's left
  const along = -span / 2 + local * speed;
  return Array.from({ length: count }, (_, k) => {
    const rank = Math.ceil(k / 2), leftSide = k % 2 === 1 ? 1 : -1;
    const back = rank * 3, out = k === 0 ? 0 : leftSide * rank * 2.4;
    const a = along - back;
    return {
      x: fx * a + lx * (side + out),
      z: fz * a + lz * (side + out),
      y: 46 + Math.sin(t * 0.5 + k * 0.7) * 0.8,
      yaw: bearing,
      pitch: 0,
      bank: Math.sin(t * 0.4 + k) * 0.06,
      phase: hash(k + 21) * 6.28,
      visible: inFlight,
    };
  });
}

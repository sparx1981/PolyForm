export interface CurtainMotion { displacement: number; velocity: number; time: number }

/** Integrate a damped fabric mode in bounded substeps, including low mobile frame rates. */
export function stepCurtainMotion(state: CurtainMotion, delta: number, wind: number, windSpeed: number, proximity: number, walkingSpeed: number) {
  const elapsed = Math.min(Math.max(delta, 0), 0.1);
  const steps = Math.max(1, Math.ceil(elapsed * 120));
  const dt = elapsed / steps;
  for (let i = 0; i < steps; i++) {
    state.time += dt;
    const gust = Math.max(0, wind) * (0.65 + 0.35 * Math.sin(state.time * windSpeed));
    const force = gust * 2.5 + proximity * walkingSpeed * 1.8;
    state.velocity += (force - 12 * state.displacement - 5 * state.velocity) * dt;
    state.displacement = Math.max(-0.2, Math.min(0.3, state.displacement + state.velocity * dt));
  }
}

export function curtainBillow(x: number, y: number, height: number, state: CurtainMotion): number {
  const free = Math.pow(Math.max(0, Math.min(1, 1 - y / Math.max(height, 0.01))), 1.5);
  return state.displacement * free * (0.8 + 0.2 * Math.sin(x * 4 + state.time * 2.2));
}

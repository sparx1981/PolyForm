/** Advance on the retained seasonal date; wrapping midnight never changes season. */
export function advanceBetaDay(date: Date, elapsedSeconds: number, hoursPerSecond: number): void {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0 || !Number.isFinite(hoursPerSecond) || hoursPerSecond <= 0) return;
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const day = 86_400_000;
  date.setTime(midnight + ((date.getTime() - midnight + elapsedSeconds * hoursPerSecond * 3_600_000) % day));
}

// Only the small clock display subscribes. Animated time never writes AppContext or the model.
const listeners = new Set<() => void>();
let snapshot = { seed: '', date: '' };
export function publishBetaTime(seed: string, date: Date): void {
  const next = date.toISOString().slice(0, 16);
  if (snapshot.seed === seed && snapshot.date === next) return;
  snapshot = { seed, date: next };
  listeners.forEach(listener => listener());
}
export function getBetaTime() { return snapshot; }
export function subscribeBetaTime(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

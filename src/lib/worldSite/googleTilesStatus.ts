import { useSyncExternalStore } from 'react';

/**
 * What the Google 3D layer is doing, for the WorldView panel: the scene component reports it
 * here and the panel shows it, so a layer that can't load says why instead of just not appearing.
 */
export interface GoogleTilesStatus {
  state: 'off' | 'connecting' | 'loading' | 'showing' | 'error';
  message: string;
  /** Tiles on screen now. */
  tiles: number;
  /** How far the tiles were moved to meet the site's ground, metres; null until measured. */
  lift: number | null;
}

let current: GoogleTilesStatus = { state: 'off', message: '', tiles: 0, lift: null };
const listeners = new Set<() => void>();

export function setGoogleTilesStatus(next: Partial<GoogleTilesStatus>): void {
  const merged = { ...current, ...next };
  if (merged.state === current.state && merged.message === current.message && merged.tiles === current.tiles && merged.lift === current.lift) return;
  current = merged;
  listeners.forEach(l => l());
}

export function useGoogleTilesStatus(): GoogleTilesStatus {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => current,
    () => current,
  );
}

/** A plain-words reason for a failed tile request. */
export function explainTileError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? '');
  if (/40[13]|denied|not authorized|PERMISSION|API key|referer/i.test(text)) {
    return "Google refused the request. Check the API key allows the Map Tiles API (Google Cloud > APIs & Services > enable 'Map Tiles API') and that billing is on and the key's website restrictions include this site.";
  }
  if (/429|quota|RESOURCE_EXHAUSTED/i.test(text)) return 'Google says the request limit has been reached (Map Tiles API quota).';
  if (/DRACO/i.test(text)) return "The tiles couldn't be unpacked (missing Draco decoder).";
  if (/Failed to fetch|NetworkError|Load failed/i.test(text)) return "The request to Google didn't get through (network, an ad blocker, or the site's content-security settings).";
  return text ? `Google 3D tiles: ${text}` : 'Google 3D tiles could not be loaded.';
}

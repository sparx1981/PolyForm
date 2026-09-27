import { EMPTY_PRESENTATION_CONTENT, type PresentationContent, type PresentationLabel, type TourStop } from '../../types';

const vec3 = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n));

/** Labels and tour stops from a saved model or project file, dropping anything malformed. */
export function normalizePresentationContent(raw: unknown): PresentationContent {
  if (!raw || typeof raw !== 'object') return EMPTY_PRESENTATION_CONTENT;
  const r = raw as Record<string, unknown>;
  const labels = (Array.isArray(r.labels) ? r.labels : []).filter((l: any): l is PresentationLabel =>
    l && typeof l.id === 'string' && typeof l.text === 'string' && vec3(l.position));
  const tour = (Array.isArray(r.tour) ? r.tour : []).filter((t: any): t is TourStop =>
    t && typeof t.id === 'string' && typeof t.title === 'string' && vec3(t.position) && vec3(t.target));
  return { labels, tour };
}

export const newContentId = () => Math.random().toString(36).slice(2, 10);

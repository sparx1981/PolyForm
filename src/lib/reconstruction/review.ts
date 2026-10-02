import {
  roomHintId,
  validateReconstructionDraft,
  type ReconstructionDraft,
  type ReconstructionIssue,
} from './draft';

export type ReconstructionReviewStatus = 'accepted' | 'review' | 'error';

export interface ReconstructionReviewItem {
  id: string;
  kind: 'wall' | 'opening' | 'furniture' | 'room';
  confidence: number;
  status: ReconstructionReviewStatus;
  issues: ReconstructionIssue[];
}

export interface ReconstructionReview {
  items: ReconstructionReviewItem[];
  accepted: number;
  review: number;
  errors: number;
}

function confidence(value?: number): number {
  return value === undefined ? 1 : Math.max(0, Math.min(1, value));
}

export function buildReconstructionReview(
  draft: ReconstructionDraft,
  options: { autoAcceptConfidence?: number } = {},
): ReconstructionReview {
  const threshold = options.autoAcceptConfidence ?? 0.85;
  const validation = validateReconstructionDraft(draft);
  const issuesFor = (id: string) => validation.issues.filter(issue => issue.entityId === id);
  const items: ReconstructionReviewItem[] = [];

  const add = (
    id: string,
    kind: ReconstructionReviewItem['kind'],
    value?: number,
  ) => {
    const issues = issuesFor(id);
    const c = confidence(value);
    const hasError = issues.some(issue => issue.severity === 'error');
    const hasWarning = issues.some(issue => issue.severity === 'warning');
    const status: ReconstructionReviewStatus = hasError
      ? 'error'
      : (hasWarning || c < threshold ? 'review' : 'accepted');
    items.push({ id, kind, confidence: c, status, issues });
  };

  for (const wall of draft.walls) add(wall.id, 'wall', wall.confidence);
  for (const opening of draft.openings ?? []) add(opening.id, 'opening', opening.confidence);
  for (const item of draft.furniture ?? []) add(item.id, 'furniture', item.confidence);
  (draft.rooms ?? []).forEach((room, index) => {
    if (room.name?.trim()) add(roomHintId(room, index), 'room', room.confidence);
  });

  return {
    items,
    accepted: items.filter(item => item.status === 'accepted').length,
    review: items.filter(item => item.status === 'review').length,
    errors: items.filter(item => item.status === 'error').length,
  };
}

/**
 * Applies explicit review decisions without mutating the original draft.
 * Openings whose host wall is rejected are automatically removed.
 */
export function applyReconstructionReview(
  draft: ReconstructionDraft,
  decisions: Record<string, boolean>,
): ReconstructionDraft {
  const keep = (id: string) => decisions[id] !== false;
  const walls = draft.walls.filter(wall => keep(wall.id));
  const wallIds = new Set(walls.map(wall => wall.id));
  return {
    ...draft,
    walls,
    openings: (draft.openings ?? []).filter(opening => keep(opening.id) && wallIds.has(opening.wallId)),
    furniture: (draft.furniture ?? []).filter(item => keep(item.id)),
    rooms: (draft.rooms ?? [])
      .map((room, index) => ({ ...room, id: roomHintId(room, index) }))
      .filter(room => keep(room.id)),
  };
}

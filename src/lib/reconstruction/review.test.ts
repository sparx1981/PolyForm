import { describe, expect, it } from 'vitest';
import type { ReconstructionDraft } from './draft';
import { applyReconstructionReview, buildReconstructionReview } from './review';

const draft = (): ReconstructionDraft => ({
  version: 1,
  source: { kind: 'image', fileName: 'plan.png' },
  coordinateSpace: 'metres',
  walls: [
    { id: 'good-wall', start: [0, 0], end: [4, 0], confidence: 0.95 },
    { id: 'review-wall', start: [0, 2], end: [4, 2], confidence: 0.7 },
  ],
  openings: [
    { id: 'door', kind: 'door', wallId: 'good-wall', centerT: 0, width: 0.9, height: 2.1, confidence: 0.96 },
  ],
  furniture: [
    { id: 'sofa', type: 'sofa', position: [2, 1], confidence: 0.8 },
  ],
});

describe('reconstruction review', () => {
  it('separates accepted candidates from items needing review', () => {
    const review = buildReconstructionReview(draft());
    expect(review.items.find(item => item.id === 'good-wall')?.status).toBe('accepted');
    expect(review.items.find(item => item.id === 'review-wall')?.status).toBe('review');
    expect(review.items.find(item => item.id === 'sofa')?.status).toBe('review');
  });

  it('marks hard validation failures as errors', () => {
    const input = draft();
    input.openings!.push({ id: 'bad', kind: 'window', wallId: 'missing', centerT: 0, width: 1, height: 1 });
    expect(buildReconstructionReview(input).items.find(item => item.id === 'bad')?.status).toBe('error');
  });

  it('removes rejected walls and dependent openings', () => {
    const filtered = applyReconstructionReview(draft(), { 'good-wall': false });
    expect(filtered.walls.map(w => w.id)).not.toContain('good-wall');
    expect(filtered.openings).toHaveLength(0);
    expect(filtered.furniture).toHaveLength(1);
  });
});

import { describe, expect, it } from 'vitest';
import { commitReconstructionDraft, validateReconstructionDraft, type ReconstructionDraft } from './draft';

const base = (): ReconstructionDraft => ({
  version: 1,
  source: { kind: 'pdf-vector', fileName: 'plan.pdf' },
  coordinateSpace: 'metres',
  walls: [
    { id: 'north', start: [0, 0], end: [4, 0], confidence: 0.99 },
    { id: 'east', start: [4, 0], end: [4, 3], confidence: 0.98 },
  ],
  openings: [
    { id: 'door-1', kind: 'door', wallId: 'north', centerT: 0, width: 0.9, height: 2.1, confidence: 0.95 },
  ],
  furniture: [
    { id: 'bed-1', type: 'bed', position: [2, 1.5], rotationY: Math.PI / 2, params: { width: 1.6 } },
  ],
});

describe('reconstruction draft pipeline', () => {
  it('validates a clean deterministic draft', () => {
    const result = validateReconstructionDraft(base());
    expect(result.valid).toBe(true);
    expect(result.errors).toBe(0);
  });

  it('flags duplicates, missing opening hosts and low confidence independently', () => {
    const draft = base();
    draft.walls.push({ id: 'north-copy', start: [4, 0], end: [0, 0] });
    draft.openings!.push({ id: 'bad-window', kind: 'window', wallId: 'missing', centerT: 0, width: 1, height: 1, confidence: 0.4 });
    const result = validateReconstructionDraft(draft);
    expect(result.issues.some(i => i.code === 'duplicate-wall' && i.entityId === 'north-copy')).toBe(true);
    expect(result.issues.some(i => i.code === 'opening-host-missing' && i.entityId === 'bad-window')).toBe(true);
    expect(result.issues.some(i => i.code === 'low-confidence' && i.entityId === 'bad-window')).toBe(true);
  });

  it('commits accepted proposals as native walls openings and furniture', () => {
    const result = commitReconstructionDraft(base());
    expect(result.shapes.map(s => s.type)).toEqual(['wall', 'wall', 'door', 'custom']);
    const door = result.shapes.find(s => s.id === 'door-1')!;
    expect(door.hostWallId).toBe('north');
    expect(door.position[0]).toBeCloseTo(2, 5);
    const bed = result.shapes.find(s => s.id === 'bed-1')!;
    expect(bed.customData.reconstruction.source.kind).toBe('pdf-vector');
  });

  it('rejects only entities with hard errors, retaining reviewable warnings', () => {
    const draft = base();
    draft.walls[0].confidence = 0.4;
    draft.openings!.push({ id: 'bad', kind: 'window', wallId: 'missing', centerT: 0, width: 1, height: 1 });
    const result = commitReconstructionDraft(draft);
    expect(result.acceptedIds).toContain('north');
    expect(result.rejectedIds).toContain('bad');
    expect(result.validation.warnings).toBeGreaterThan(0);
  });
});

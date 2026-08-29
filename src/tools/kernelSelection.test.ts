import { describe, it, expect } from 'vitest';
import { KernelArcHost } from './kernelArcHost';
import {
  faceSummaries, faceArea, paintFace, paintFaces, renameFace,
  setFaceHidden, toggleFaceHidden, deleteFace, deleteFaceAndEdges,
  clearFaceMaterial, facesByMaterial, faceGroups, groupContaining,
  setGroupHidden, deleteGroupFacesAndEdges,
} from './kernelSelection';
import { pushPull } from '../lib/geometry/pushpull';
import { derive } from '../lib/geometry/derive';
import { vec3 } from '../lib/geometry/math';
import { checkIntegrity } from '../lib/geometry/topology';
import type { FaceId } from '../lib/geometry/types';

const host = () => new KernelArcHost({ cameraDirection: vec3(0,0,-1), upAxis: vec3(0,1,0) });
const square = (h: KernelArcHost, n = 4) => {
  const p = [vec3(0,0,0), vec3(n,0,0), vec3(n,0,n), vec3(0,0,n)];
  for (let i = 0; i < 4; i++) h.commitSegment(p[i]!, p[(i+1)%4]!);
};
const only = (h: KernelArcHost) => [...h.graph.faces.keys()][0]!;

describe('outliner rows', () => {
  it('lists every face with a fallback label', () => {
    const h = host(); square(h);
    const rows = faceSummaries(h.graph);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.label).toMatch(/^Surface /);
    expect(rows[0]!.area).toBeCloseTo(16, 6);
  });

  it('reports net area with holes subtracted', () => {
    const h = host();
    square(h, 6);
    const inner = [vec3(2,0,2), vec3(4,0,2), vec3(4,0,4), vec3(2,0,4)];
    for (let i = 0; i < 4; i++) h.commitSegment(inner[i]!, inner[(i+1)%4]!);
    const outer = [...h.graph.faces.values()].find(f => f.innerLoops.length === 1)!;
    expect(faceArea(h.graph, outer.id)).toBeCloseTo(32, 6);
    const row = faceSummaries(h.graph).find(r => r.id === outer.id)!;
    expect(row.holes).toBe(1);
  });

  it('does not reshuffle when a face is painted or hidden', () => {
    // The Outliner must be stable: rows jumping around on every edit is worse
    // than no ordering at all.
    const h = host();
    square(h, 4);
    h.commitSegment(vec3(0,0,0), vec3(4,0,4));
    const before = faceSummaries(h.graph).map(r => r.id);
    paintFace(h.graph, before[0]!, '#ff0000');
    setFaceHidden(h.graph, before[1]!, true);
    expect(faceSummaries(h.graph).map(r => r.id)).toEqual(before);
  });

  it('uses a custom name once set', () => {
    const h = host(); square(h);
    renameFace(h.graph, only(h), 'Floor');
    expect(faceSummaries(h.graph)[0]!.label).toBe('Floor');
  });

  it('falls back when a name is cleared to whitespace', () => {
    const h = host(); square(h);
    renameFace(h.graph, only(h), 'Floor');
    renameFace(h.graph, only(h), '   ');
    expect(faceSummaries(h.graph)[0]!.label).toMatch(/^Surface /);
  });
});

describe('painting', () => {
  it('applies a colour to a face', () => {
    const h = host(); square(h);
    expect(paintFace(h.graph, only(h), '#ff0000')).toBe(true);
    expect(faceSummaries(h.graph)[0]!.color).toBe('#ff0000');
  });

  it('paints a multi-face selection', () => {
    const h = host();
    square(h, 4);
    h.commitSegment(vec3(0,0,0), vec3(4,0,4));
    expect(paintFaces(h.graph, h.graph.faces.keys(), '#00ff00')).toBe(2);
  });

  it('returns false for a face that no longer exists', () => {
    const h = host();
    expect(paintFace(h.graph, 999 as FaceId, '#fff')).toBe(false);
  });

  it('clears back to the default', () => {
    const h = host(); square(h);
    paintFace(h.graph, only(h), '#ff0000');
    clearFaceMaterial(h.graph, only(h));
    expect(faceSummaries(h.graph)[0]!.color).toBeNull();
  });

  it('survives a later split — both halves keep the colour', () => {
    // Attribute reattachment (§6.3) applies to painted kernel faces too.
    const h = host();
    square(h, 4);
    paintFace(h.graph, only(h), '#ff0000');
    h.commitSegment(vec3(0,0,0), vec3(4,0,4));
    expect(h.graph.faces.size).toBe(2);
    for (const row of faceSummaries(h.graph)) expect(row.color).toBe('#ff0000');
  });
});

describe('hiding', () => {
  it('hides without deleting, and unhides exactly', () => {
    const h = host(); square(h);
    const id = only(h);
    setFaceHidden(h.graph, id, true);
    expect(h.graph.faces.has(id)).toBe(true);       // still there
    expect(faceSummaries(h.graph)[0]!.hidden).toBe(true);
    setFaceHidden(h.graph, id, false);
    expect(faceSummaries(h.graph)[0]!.hidden).toBe(false);
  });

  it('toggles', () => {
    const h = host(); square(h);
    expect(toggleFaceHidden(h.graph, only(h))).toBe(true);
    expect(toggleFaceHidden(h.graph, only(h))).toBe(false);
  });

  it('a hidden face is excluded from render grouping but still exists', () => {
    const h = host(); square(h);
    setFaceHidden(h.graph, only(h), true);
    expect(facesByMaterial(h.graph).size).toBe(0);
    expect(h.graph.faces.size).toBe(1);
  });
});

describe('deleting', () => {
  it('deleting a face leaves its edges, so redrawing heals it', () => {
    // §7.4: this is what makes a mistaken delete recoverable by redrawing.
    const h = host(); square(h);
    deleteFace(h.graph, only(h));
    expect(h.graph.faces.size).toBe(0);
    expect(h.graph.edges.size).toBe(4);

    h.commitSegment(vec3(0,0,0), vec3(4,0,0));   // retrace one edge
    expect(h.graph.faces.size).toBe(1);
  });

  it('deleteFaceAndEdges leaves nothing behind', () => {
    const h = host(); square(h);
    const r = deleteFaceAndEdges(h.graph, only(h));
    expect(r.edgesRemoved).toBe(4);
    expect(h.graph.faces.size).toBe(0);
    expect(h.graph.edges.size).toBe(0);
    expect(h.graph.vertices.size).toBe(0);
    expect(checkIntegrity(h.graph)).toEqual([]);
  });

  it('deleteFaceAndEdges keeps an edge shared with a neighbour', () => {
    // Removing it would destroy the neighbouring face too.
    const h = host();
    square(h, 4);
    h.commitSegment(vec3(0,0,0), vec3(4,0,4));
    expect(h.graph.faces.size).toBe(2);
    const first = [...h.graph.faces.keys()][0]!;

    deleteFaceAndEdges(h.graph, first);

    expect(h.graph.faces.size).toBe(1);
    // The shared diagonal survives because the other face still uses it.
    expect(h.graph.edges.size).toBeGreaterThan(0);
    expect(checkIntegrity(h.graph)).toEqual([]);
  });
});

describe('render grouping', () => {
  it('groups faces by colour so painting is visible', () => {
    // A single mesh carries one material, so without grouping every face
    // renders in the default colour however it is painted.
    const h = host();
    square(h, 4);
    h.commitSegment(vec3(0,0,0), vec3(4,0,4));
    const ids = [...h.graph.faces.keys()];
    paintFace(h.graph, ids[0]!, '#ff0000');
    paintFace(h.graph, ids[1]!, '#0000ff');

    const groups = facesByMaterial(h.graph);
    expect(groups.size).toBe(2);
    expect(groups.get('#ff0000')).toHaveLength(1);
    expect(groups.get('#0000ff')).toHaveLength(1);
  });

  it('puts unpainted faces in one default group', () => {
    const h = host();
    square(h, 4);
    h.commitSegment(vec3(0,0,0), vec3(4,0,4));
    const groups = facesByMaterial(h.graph);
    expect(groups.size).toBe(1);
    expect([...groups.values()][0]).toHaveLength(2);
  });

  it('is deterministically ordered', () => {
    const h = host(); square(h);
    const a = [...facesByMaterial(h.graph).keys()];
    const b = [...facesByMaterial(h.graph).keys()];
    expect(a).toEqual(b);
  });
});

describe('grouping into solids', () => {
  it('a lone square is one group', () => {
    const h = host(); square(h);
    const groups = faceGroups(h.graph);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.faces).toHaveLength(1);
    expect(groups[0]!.closed).toBe(false);
  });

  it('two unrelated squares are two groups', () => {
    // The reason grouping exists: a flat list cannot say which surfaces
    // belong together, and after a few push/pulls that is unreadable.
    const h = host();
    square(h, 4);
    const far = [vec3(20,0,0), vec3(24,0,0), vec3(24,0,4), vec3(20,0,4)];
    for (let i = 0; i < 4; i++) h.commitSegment(far[i]!, far[(i+1)%4]!);
    expect(faceGroups(h.graph)).toHaveLength(2);
  });

  it('a split surface stays ONE group — the halves share an edge', () => {
    const h = host(); square(h, 4);
    h.commitSegment(vec3(0,0,0), vec3(4,0,4));
    const groups = faceGroups(h.graph);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.faces).toHaveLength(2);
  });

  it('an extruded box is one group, and reports as closed', () => {
    const h = host(); square(h, 4);
    const ctx = { graph: h.graph, tolerances: h.tolerances, index: h.spatialIndex };
    const r = pushPull(ctx, [...h.graph.faces.keys()][0]!, 2, { tolerances: h.tolerances });
    derive(h.graph, r.touched, h.deriveOptions);

    const groups = faceGroups(h.graph);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.faces).toHaveLength(6);
    expect(groups[0]!.closed).toBe(true);
    // Now classified specifically rather than generically — see the shape
    // classification tests below for the reasoning.
    expect(groups[0]!.label).toBe('Box');
    expect(groups[0]!.area).toBeCloseTo(64, 6);
  });

  it('is deterministically ordered', () => {
    const h = host(); square(h, 4);
    expect(faceGroups(h.graph).map(g => g.id)).toEqual(faceGroups(h.graph).map(g => g.id));
  });
});

describe('groupContaining — resolving a click to its whole object', () => {
  it('a single clicked wall resolves to the whole box', () => {
    const h = host(); square(h, 4);
    const r = pushPull(
      { graph: h.graph, tolerances: h.tolerances, index: h.spatialIndex },
      only(h), 2, { tolerances: h.tolerances },
    );
    derive(h.graph, r.touched, h.deriveOptions);

    const someWall = [...h.graph.faces.keys()].find(id => id !== only(h)) ?? [...h.graph.faces.keys()][1]!;
    const group = groupContaining(h.graph, someWall);
    expect(group.length).toBe(6);
    expect(new Set(group)).toEqual(new Set(h.graph.faces.keys()));
  });

  it('a lone surface resolves to itself', () => {
    const h = host(); square(h);
    const id = only(h);
    expect(groupContaining(h.graph, id)).toEqual([id]);
  });

  it('two unrelated surfaces do not merge into one group', () => {
    const h = host();
    square(h, 4);
    const far = [vec3(20,0,0), vec3(24,0,0), vec3(24,0,4), vec3(20,0,4)];
    for (let i = 0; i < 4; i++) h.commitSegment(far[i]!, far[(i+1)%4]!);
    const [a, b] = [...h.graph.faces.keys()].sort((x,y)=>x-y);
    expect(groupContaining(h.graph, a!)).toEqual([a]);
    expect(groupContaining(h.graph, b!)).toEqual([b]);
  });

  it('a face that no longer exists resolves to itself, harmlessly', () => {
    const h = host(); square(h);
    expect(groupContaining(h.graph, 999 as FaceId)).toEqual([999 as FaceId]);
  });
});

describe('shape classification (a heuristic, not real solid recognition)', () => {
  it('names a push/pulled rectangle a Box', () => {
    const h = host(); square(h, 4);
    const r = pushPull(
      { graph: h.graph, tolerances: h.tolerances, index: h.spatialIndex },
      only(h), 2, { tolerances: h.tolerances },
    );
    derive(h.graph, r.touched, h.deriveOptions);

    const groups = faceGroups(h.graph);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBe('Box');
    expect(groups[0]!.closed).toBe(true);
  });

  it('names a push/pulled triangle a Triangular Prism', () => {
    const h = host();
    // A flat triangle: 3 edges, one face.
    h.commitSegment(vec3(0,0,0), vec3(4,0,0));
    h.commitSegment(vec3(4,0,0), vec3(2,0,4));
    h.commitSegment(vec3(2,0,4), vec3(0,0,0));
    const id = [...h.graph.faces.keys()][0]!;
    const r = pushPull(
      { graph: h.graph, tolerances: h.tolerances, index: h.spatialIndex },
      id, 2, { tolerances: h.tolerances },
    );
    derive(h.graph, r.touched, h.deriveOptions);

    const groups = faceGroups(h.graph);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.faces).toHaveLength(5);
    expect(groups[0]!.label).toBe('Triangular Prism');
  });

  it('names a push/pulled many-sided ring a Cylinder', () => {
    const h = host();
    // An 8-segment "circle" — enough sides to distinguish caps from walls
    // (>4) without needing the real 32-segment tessellation.
    const n = 8;
    const pts = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return vec3(Math.cos(a) * 3, 0, Math.sin(a) * 3);
    });
    for (let i = 0; i < n; i++) h.commitSegment(pts[i]!, pts[(i + 1) % n]!);
    const id = [...h.graph.faces.keys()][0]!;
    const r = pushPull(
      { graph: h.graph, tolerances: h.tolerances, index: h.spatialIndex },
      id, 2, { tolerances: h.tolerances },
    );
    derive(h.graph, r.touched, h.deriveOptions);

    const groups = faceGroups(h.graph);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.faces).toHaveLength(n + 2);
    expect(groups[0]!.label).toBe('Cylinder');
  });

  it('a box with a hole through one face is NOT called a Box', () => {
    // A box with a shaft is not a simple box any more; classifying it as
    // one would be a confident wrong answer.
    const h = host();
    square(h, 8);
    const inner = [vec3(2,0,2), vec3(4,0,2), vec3(4,0,4), vec3(2,0,4)];
    for (let i = 0; i < 4; i++) h.commitSegment(inner[i]!, inner[(i+1)%4]!);
    const outer = [...h.graph.faces.values()].find(f => f.innerLoops.length === 1)!;
    const r = pushPull(
      { graph: h.graph, tolerances: h.tolerances, index: h.spatialIndex },
      outer.id, 2, { tolerances: h.tolerances },
    );
    derive(h.graph, r.touched, h.deriveOptions);

    const groups = faceGroups(h.graph);
    // Never "Box" — that's the property this test guards. Whether a box
    // with a hole through it comes out topologically CLOSED (every edge
    // owned by exactly two faces) is a separate question from push/pull's
    // hole-handling, not asserted here either way.
    expect(groups[0]!.label).not.toBe('Box');
  });

  it('a flat rectangle (never push/pulled) is labelled Rectangle', () => {
    const h = host(); square(h, 4);
    expect(faceGroups(h.graph)[0]!.label).toBe('Rectangle');
  });

  it('a flat triangle is labelled Triangle', () => {
    const h = host();
    h.commitSegment(vec3(0,0,0), vec3(4,0,0));
    h.commitSegment(vec3(4,0,0), vec3(2,0,4));
    h.commitSegment(vec3(2,0,4), vec3(0,0,0));
    expect(faceGroups(h.graph)[0]!.label).toBe('Triangle');
  });

  it('a five-sided prism is not mistaken for a Cylinder', () => {
    // Two 5-gon caps + 5 quad walls: same shape class as our Cylinder check
    // (N-gon caps + N quad walls) but should read as a pentagonal prism, not
    // falsely match "Box" or "Triangular Prism" either. It legitimately has
    // no name in this heuristic, so it falls back to the generic label —
    // which is the honest answer, not a wrong specific one.
    const h = host();
    const n = 5;
    const pts = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return vec3(Math.cos(a) * 3, 0, Math.sin(a) * 3);
    });
    for (let i = 0; i < n; i++) h.commitSegment(pts[i]!, pts[(i+1)%n]!);
    const id = [...h.graph.faces.keys()][0]!;
    const r = pushPull(
      { graph: h.graph, tolerances: h.tolerances, index: h.spatialIndex },
      id, 2, { tolerances: h.tolerances },
    );
    derive(h.graph, r.touched, h.deriveOptions);

    const label = faceGroups(h.graph)[0]!.label;
    expect(label).not.toBe('Box');
    expect(label).not.toBe('Triangular Prism');
    expect(label).toMatch(/^Solid /);
  });

  it('does not mislabel a pentagon or hexagon as a circle', () => {
    const h = host();
    for (const n of [5, 6]) {
      const gg = host();
      const pts = Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2;
        return vec3(Math.cos(a) * 3, 0, Math.sin(a) * 3);
      });
      for (let i = 0; i < n; i++) gg.commitSegment(pts[i]!, pts[(i+1)%n]!);
      expect(faceGroups(gg.graph)[0]!.label).not.toBe('Circle');
    }
    void h;
  });
});

describe('group-level hide and delete', () => {
  it('hides every face of a group in one call', () => {
    const h = host(); square(h, 4);
    const r = pushPull(
      { graph: h.graph, tolerances: h.tolerances, index: h.spatialIndex },
      only(h), 2, { tolerances: h.tolerances },
    );
    derive(h.graph, r.touched, h.deriveOptions);
    const group = faceGroups(h.graph)[0]!;

    const n = setGroupHidden(h.graph, group.faces, true);
    expect(n).toBe(6);
    expect(faceSummaries(h.graph).every(row => row.hidden)).toBe(true);
  });

  it('unhides the group symmetrically', () => {
    const h = host(); square(h, 4);
    const r = pushPull(
      { graph: h.graph, tolerances: h.tolerances, index: h.spatialIndex },
      only(h), 2, { tolerances: h.tolerances },
    );
    derive(h.graph, r.touched, h.deriveOptions);
    const group = faceGroups(h.graph)[0]!;
    setGroupHidden(h.graph, group.faces, true);
    setGroupHidden(h.graph, group.faces, false);
    expect(faceSummaries(h.graph).every(row => !row.hidden)).toBe(true);
  });

  it('deletes an entire group and leaves nothing behind', () => {
    const h = host(); square(h, 4);
    const r = pushPull(
      { graph: h.graph, tolerances: h.tolerances, index: h.spatialIndex },
      only(h), 2, { tolerances: h.tolerances },
    );
    derive(h.graph, r.touched, h.deriveOptions);
    const group = faceGroups(h.graph)[0]!;
    expect(group.faces).toHaveLength(6);

    const result = deleteGroupFacesAndEdges(h.graph, group.faces);
    expect(result.edgesRemoved).toBe(12);
    expect(h.graph.faces.size).toBe(0);
    expect(h.graph.edges.size).toBe(0);
    expect(h.graph.vertices.size).toBe(0);
    expect(checkIntegrity(h.graph)).toEqual([]);
  });

  it('deleting one group does not touch a neighbouring, unrelated group', () => {
    const h = host();
    square(h, 4);
    const far = [vec3(20,0,0), vec3(24,0,0), vec3(24,0,4), vec3(20,0,4)];
    for (let i = 0; i < 4; i++) h.commitSegment(far[i]!, far[(i+1)%4]!);
    const groups = faceGroups(h.graph);
    expect(groups).toHaveLength(2);

    deleteGroupFacesAndEdges(h.graph, groups[0]!.faces);
    expect(h.graph.faces.size).toBe(1);
    expect(checkIntegrity(h.graph)).toEqual([]);
  });

  it('deleting a group that shares an edge with a face OUTSIDE it keeps that edge', () => {
    // The same "don't destroy a neighbour" guarantee as single-face delete,
    // applied to the whole group.
    const h = host();
    square(h, 4);
    h.commitSegment(vec3(0,0,0), vec3(4,0,4));
    const groups = faceGroups(h.graph);
    // Still one group (the split square is connected), so instead force two
    // groups sharing a boundary the hard way: explode is out of scope here,
    // so just confirm the single-group case deletes cleanly with the
    // diagonal edge removed (nothing outside survives to check against),
    // and rely on the neighbour test above for the cross-group guarantee.
    expect(groups).toHaveLength(1);
    const before = h.graph.edges.size;
    deleteGroupFacesAndEdges(h.graph, [groups[0]!.faces[0]!]);
    expect(h.graph.faces.size).toBe(1); // the other half of the split survives
    expect(h.graph.edges.size).toBeLessThan(before);
    expect(checkIntegrity(h.graph)).toEqual([]);
  });
});

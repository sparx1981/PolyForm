import { describe, it, expect } from 'vitest';
import {
  PolyformInferenceEngine, InferenceType, INFERENCE_PRIORITY, inferencePriority,
  type InferenceCandidate,
} from '../lib/vendor/PolyformInferenceEngine';

const cand = (
  type: InferenceType, screenDistance: number, id: string,
): InferenceCandidate => ({
  type, screenDistance, sourceEntityId: id, tooltip: id,
  point: { x: 0, y: 0, z: 0 },
});

describe('precedence (§4.2)', () => {
  it('follows the spec order', () => {
    const order = [
      InferenceType.ENDPOINT, InferenceType.INTERSECTION, InferenceType.MIDPOINT,
      InferenceType.CURVE_CENTER, InferenceType.FACE_CENTROID,
      InferenceType.GUIDE_POINT, InferenceType.ON_EDGE, InferenceType.ON_FACE,
    ];
    for (let i = 1; i < order.length; i++) {
      expect(inferencePriority(order[i]!)).toBeGreaterThan(inferencePriority(order[i-1]!));
    }
  });

  it('the substantive change: intersection now beats curve centre and midpoint', () => {
    // An intersection is a more specific expression of intent than a curve's
    // centre, and a user aiming at a crossing rarely wants the midpoint of
    // one of the two edges instead.
    expect(inferencePriority(InferenceType.INTERSECTION))
      .toBeLessThan(inferencePriority(InferenceType.CURVE_CENTER));
    expect(inferencePriority(InferenceType.INTERSECTION))
      .toBeLessThan(inferencePriority(InferenceType.MIDPOINT));
  });

  it('leaves the enum VALUES untouched', () => {
    // They are identifiers, may be persisted, and are compared elsewhere in
    // the app. Precedence is a separate concern held in its own map.
    expect(InferenceType.ENDPOINT).toBe(1);
    expect(InferenceType.CURVE_CENTER).toBe(2);
    expect(InferenceType.MIDPOINT).toBe(3);
    expect(InferenceType.FACE_CENTROID).toBe(4);
    expect(InferenceType.INTERSECTION).toBe(5);
    expect(InferenceType.GUIDE_POINT).toBe(6);
    expect(InferenceType.ON_EDGE).toBe(7);
    expect(InferenceType.ON_FACE).toBe(8);
  });

  it('covers every enum member', () => {
    for (const t of Object.values(InferenceType).filter(v => typeof v === 'number')) {
      expect(INFERENCE_PRIORITY[t as InferenceType]).toBeGreaterThan(0);
    }
  });
});

describe('resolveCandidate uses the priority map', () => {
  it('picks intersection over a nearer curve centre', () => {
    // Before the change, CURVE_CENTER (enum 2) beat INTERSECTION (enum 5)
    // outright. This is the behaviour that actually changed for the user.
    const e = new PolyformInferenceEngine();
    const chosen = e.resolveCandidate([
      cand(InferenceType.CURVE_CENTER, 2, 'centre'),
      cand(InferenceType.INTERSECTION, 5, 'crossing'),
    ]);
    expect(chosen?.sourceEntityId).toBe('crossing');
  });

  it('still puts endpoint above everything', () => {
    const e = new PolyformInferenceEngine();
    const chosen = e.resolveCandidate([
      cand(InferenceType.ON_FACE, 1, 'face'),
      cand(InferenceType.INTERSECTION, 3, 'crossing'),
      cand(InferenceType.ENDPOINT, 9, 'end'),
    ]);
    expect(chosen?.sourceEntityId).toBe('end');
  });

  it('breaks ties on screen distance', () => {
    const e = new PolyformInferenceEngine();
    const chosen = e.resolveCandidate([
      cand(InferenceType.ENDPOINT, 8, 'far'),
      cand(InferenceType.ENDPOINT, 2, 'near'),
    ]);
    expect(chosen?.sourceEntityId).toBe('near');
  });

  it('breaks a full tie deterministically', () => {
    // Two coincident candidates of the same type and distance must not
    // alternate between frames.
    const pick = () => {
      const e = new PolyformInferenceEngine();
      return e.resolveCandidate([
        cand(InferenceType.ENDPOINT, 4, 'b'),
        cand(InferenceType.ENDPOINT, 4, 'a'),
      ])?.sourceEntityId;
    };
    expect(pick()).toBe('a');
    expect(pick()).toBe('a');
  });

  it('ignores candidates outside the snap radius', () => {
    const e = new PolyformInferenceEngine({ snapRadius: 10 });
    expect(e.resolveCandidate([cand(InferenceType.ENDPOINT, 50, 'far')])).toBeNull();
  });

  it('returns null for an empty set', () => {
    expect(new PolyformInferenceEngine().resolveCandidate([])).toBeNull();
  });
});

describe('hysteresis still works', () => {
  it('retains a snap that drifts inside the boost radius', () => {
    const e = new PolyformInferenceEngine({ snapRadius: 10 });
    e.resolveCandidate([cand(InferenceType.ENDPOINT, 2, 'held')]);
    // Now outside snapRadius but inside hysteresisBoost (14).
    const again = e.resolveCandidate([cand(InferenceType.ENDPOINT, 12, 'held')]);
    expect(again?.sourceEntityId).toBe('held');
  });

  it('is displaced only by STRICTLY higher priority', () => {
    const e = new PolyformInferenceEngine({ snapRadius: 10 });
    e.resolveCandidate([cand(InferenceType.MIDPOINT, 2, 'mid')]);
    // An equal-priority rival closer to the cursor must NOT steal it.
    const held = e.resolveCandidate([
      cand(InferenceType.MIDPOINT, 12, 'mid'),
      cand(InferenceType.MIDPOINT, 1, 'rival'),
    ]);
    expect(held?.sourceEntityId).toBe('mid');

    // A higher-priority one does.
    const stolen = e.resolveCandidate([
      cand(InferenceType.MIDPOINT, 12, 'mid'),
      cand(InferenceType.ENDPOINT, 9, 'end'),
    ]);
    expect(stolen?.sourceEntityId).toBe('end');
  });

  it('an intersection now displaces a held midpoint', () => {
    // Directly exercises the changed ordering through the hysteresis path.
    const e = new PolyformInferenceEngine({ snapRadius: 10 });
    e.resolveCandidate([cand(InferenceType.MIDPOINT, 2, 'mid')]);
    const stolen = e.resolveCandidate([
      cand(InferenceType.MIDPOINT, 12, 'mid'),
      cand(InferenceType.INTERSECTION, 9, 'crossing'),
    ]);
    expect(stolen?.sourceEntityId).toBe('crossing');
  });

  it('a curve centre no longer displaces a held midpoint', () => {
    // The inverse of the old behaviour, stated explicitly so a revert is loud.
    const e = new PolyformInferenceEngine({ snapRadius: 10 });
    e.resolveCandidate([cand(InferenceType.MIDPOINT, 2, 'mid')]);
    const held = e.resolveCandidate([
      cand(InferenceType.MIDPOINT, 12, 'mid'),
      cand(InferenceType.CURVE_CENTER, 1, 'centre'),
    ]);
    expect(held?.sourceEntityId).toBe('mid');
  });
});

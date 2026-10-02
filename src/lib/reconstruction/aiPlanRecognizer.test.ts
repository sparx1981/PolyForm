import { describe, expect, it } from 'vitest';
import {
  attachOpenings,
  bridgeOpeningGaps,
  cleanWalls,
  realisticOpeningWidth,
  parseAiPlanResponse,
  recogniseFloorPlanWithAi,
  refineWallsToInk,
  type PxWall,
} from './aiPlanRecognizer';
import { imageObservationToDraft } from './imageAdapter';
import { applyReconstructionReview, buildReconstructionReview } from './review';
import { commitReconstructionDraft } from './draft';

const wall = (ax: number, ay: number, bx: number, by: number, extra: Partial<PxWall> = {}): PxWall => ({
  a: [ax, ay], b: [bx, by], exterior: false, confidence: 0.9, ...extra,
});

describe('parseAiPlanResponse', () => {
  it('accepts fenced JSON, clamps coordinates and drops malformed entries', () => {
    const parsed = parseAiPlanResponse('```json\n' + JSON.stringify({
      walls: [{ x1: -5, y1: 0, x2: 1200, y2: 0 }, { x1: 'a', y1: 0, x2: 1, y2: 1 }],
      openings: [{ kind: 'door', x: 10, y: 10, width: 20 }, { kind: 'gate', x: 1, y: 1, width: 5 }],
      rooms: [{ name: ' Kitchen ', x: 500, y: 500 }, { name: '', x: 1, y: 1 }],
      notes: ['two floors', 7],
    }) + '\n```');
    expect(parsed.walls).toEqual([expect.objectContaining({ x1: 0, x2: 1000 })]);
    expect(parsed.openings).toHaveLength(1);
    expect(parsed.rooms).toEqual([expect.objectContaining({ name: 'Kitchen' })]);
    expect(parsed.notes).toEqual(['two floors']);
  });

  it('rejects non-JSON and responses without walls', () => {
    expect(() => parseAiPlanResponse('sorry')).toThrow(/valid JSON/);
    expect(() => parseAiPlanResponse('{"rooms":[]}')).toThrow(/wall list/);
  });
});

describe('cleanWalls', () => {
  const opts = { tolerance: 10, minLength: 8 };

  it('joins corners, snaps near-axis walls and keeps genuinely angled walls angled', () => {
    const out = cleanWalls([
      wall(0, 0, 200, 3),       // ~1° off horizontal
      wall(204, 4, 205, 150),   // ~vertical, corner 4–5 px off
      wall(205, 150, 345, 60),  // diagonal, must stay diagonal
    ], opts);
    expect(out).toHaveLength(3);
    expect(out[0].a[1]).toBe(out[0].b[1]);
    expect(out[1].a[0]).toBe(out[1].b[0]);
    expect(out[2].b[1]).not.toBe(out[2].a[1]);
    expect(out[2].b[0]).not.toBe(out[2].a[0]);
    expect(out[0].b).toEqual(out[1].a);
    expect(out[1].b[1]).toBeCloseTo(150, 0);
  });

  it('merges overlapping collinear walls and removes duplicates and slivers', () => {
    const out = cleanWalls([
      wall(0, 0, 100, 0),
      wall(90, 2, 220, 2),
      wall(0, 0, 100, 0),
      wall(300, 300, 303, 300),
    ], opts);
    expect(out).toHaveLength(1);
    expect(Math.abs(out[0].b[0] - out[0].a[0])).toBeGreaterThan(215);
  });

  it('snaps a wall end that lands on another wall\'s side onto it', () => {
    const out = cleanWalls([wall(0, 0, 300, 0), wall(150, 80, 150, 6)], opts);
    const stem = out.find(w => w.a[0] === 150)!;
    expect(stem.b[1]).toBeCloseTo(0, 5);
  });
});

describe('refineWallsToInk', () => {
  function blank(w: number, h: number) {
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    const ink = (x: number, y: number) => {
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 0;
    };
    return { width: w, height: h, data, ink };
  }

  it('slides a wall sideways onto the drawn line, at any angle', () => {
    const img = blank(300, 300);
    // diagonal wall 4 px thick running along y = x
    for (let t = 20; t < 280; t++) for (let o = -2; o <= 2; o++) img.ink(t, Math.min(299, Math.max(0, t + o)));
    // the model's line is 6 px off (perpendicular shift of roughly 4 px in each axis)
    const [refined] = refineWallsToInk([wall(30, 24, 270, 264)], img, { reach: 12 });
    const dist = (p: [number, number]) => Math.abs(p[1] - p[0]) / Math.SQRT2;
    expect(dist(refined.a)).toBeLessThan(1.5);
    expect(dist(refined.b)).toBeLessThan(1.5);
  });

  it('leaves a wall alone when there is no ink nearby', () => {
    const img = blank(100, 100);
    const [same] = refineWallsToInk([wall(10, 10, 90, 10)], img, { reach: 8 });
    expect(same.a).toEqual([10, 10]);
  });
});

describe('attachOpenings', () => {
  const hosts = [{ id: 'w1', a: [0, 0] as [number, number], b: [400, 0] as [number, number], thickness: 10 }];

  it('hosts an opening on the nearest wall and converts to wall-relative form', () => {
    const { openings, dropped } = attachOpenings(
      [{ kind: 'door', at: [100, 4], widthPx: 36, confidence: 0.9 }], hosts, 0.025, 10,
    );
    expect(dropped).toBe(0);
    expect(openings[0]).toMatchObject({ wallId: 'w1', kind: 'door', id: 'ai-door-1' });
    expect(openings[0].centerT).toBeCloseTo(-0.25, 2);
    expect(openings[0].width).toBeCloseTo(0.91, 2); // 0.9 m snaps to the standard 36 in leaf
  });

  it('drops floating openings and de-duplicates overlapping ones', () => {
    const { openings, dropped } = attachOpenings([
      { kind: 'window', at: [100, 200], widthPx: 40, confidence: 0.9 },
      { kind: 'window', at: [200, 0], widthPx: 40, confidence: 0.9 },
      { kind: 'window', at: [210, 0], widthPx: 40, confidence: 0.6 },
    ], hosts, 0.025, 10);
    expect(openings).toHaveLength(1);
    expect(dropped).toBe(2);
  });
});

describe('recogniseFloorPlanWithAi', () => {
  // A skewed (non-orthogonal) building: a parallelogram with a door, window and two rooms.
  const response = {
    walls: [
      { x1: 100, y1: 100, x2: 800, y2: 140, exterior: true, confidence: 0.95 },
      { x1: 800, y1: 140, x2: 700, y2: 900, exterior: true, confidence: 0.95 },
      { x1: 700, y1: 900, x2: 0, y2: 860, exterior: true, confidence: 0.95 },
      { x1: 0, y1: 860, x2: 100, y2: 100, exterior: true, confidence: 0.95 },
      { x1: 450, y1: 120, x2: 350, y2: 880, confidence: 0.8 },
    ],
    openings: [
      { kind: 'door', x: 400, y: 500, width: 40 },
      { kind: 'window', x: 450, y: 120, width: 60 },
    ],
    rooms: [{ name: 'Kitchen', x: 600, y: 500 }, { name: 'Bedroom', x: 200, y: 500 }],
    notes: ['Hatching was ignored.'],
  };

  it('turns a model response into a reviewable, committable draft', async () => {
    const observation = await recogniseFloorPlanWithAi({
      imageDataUrl: 'data:image/jpeg;base64,AAAA',
      imageSize: [1000, 800],
      metresPerPixel: 0.02,
      generate: async req => {
        expect(req.prompt).toMatch(/ANY angle/);
        return JSON.stringify(response);
      },
      fileName: 'skewed.png',
    });

    expect(observation.walls).toHaveLength(5);
    expect(observation.walls[0].thickness).toBeCloseTo(0.25);
    expect(observation.walls[4].thickness).toBeCloseTo(0.12);
    expect(observation.openings?.map(o => o.kind).sort()).toEqual(['door', 'window']);
    expect(observation.rooms?.map(r => r.name)).toEqual(['Kitchen', 'Bedroom']);
    expect(observation.uncertainties).toContain('Hatching was ignored.');

    const draft = imageObservationToDraft(observation);
    const review = buildReconstructionReview(draft);
    expect(review.items.filter(i => i.kind === 'room')).toHaveLength(2);
    expect(review.errors).toBe(0);

    // Reject the Bedroom label in review; the Kitchen label and all geometry commit.
    const bedroomId = review.items.filter(i => i.kind === 'room')[1].id;
    const reviewed = applyReconstructionReview(draft, { [bedroomId]: false });
    const result = commitReconstructionDraft(reviewed);
    expect(result.shapes.filter(s => s.type === 'wall')).toHaveLength(5);
    expect(result.shapes.filter(s => s.type === 'door' || s.type === 'window')).toHaveLength(2);
    const labels = result.shapes.filter(s => s.type === 'text');
    expect(labels.map(s => s.textData?.text)).toEqual(['Kitchen']);
    // An angled wall really is angled in the committed model.
    const angled = result.shapes.filter(s => s.type === 'wall')
      .some(s => Math.abs(Math.sin(2 * s.rotation![1])) > 0.05);
    expect(angled).toBe(true);
  });

  it('requires calibration and surfaces unusable responses', async () => {
    await expect(recogniseFloorPlanWithAi({
      imageDataUrl: '', imageSize: [10, 10], metresPerPixel: 0, generate: async () => '{}',
    })).rejects.toThrow(/calibration/);
    await expect(recogniseFloorPlanWithAi({
      imageDataUrl: '', imageSize: [10, 10], metresPerPixel: 0.1, generate: async () => 'nope',
    })).rejects.toThrow(/valid JSON/);
  });
});

describe('bridgeOpeningGaps', () => {
  it('makes one wall of two pieces with a door between them, and leaves real gaps alone', () => {
    const pieces = [wall(0, 100, 300, 100), wall(380, 101, 700, 100)];
    const bridged = bridgeOpeningGaps(pieces, [{ at: [340, 100], widthPx: 70 }], { tolerance: 10, maxGap: 200 });
    expect(bridged).toHaveLength(1);
    expect(Math.min(bridged[0].a[0], bridged[0].b[0])).toBeCloseTo(0, 5);
    expect(Math.max(bridged[0].a[0], bridged[0].b[0])).toBeCloseTo(700, 5);
    // Nothing in the gap: an open doorway-less break stays open.
    expect(bridgeOpeningGaps(pieces, [], { tolerance: 10, maxGap: 200 })).toHaveLength(2);
    // An opening on some other wall does not bridge it.
    expect(bridgeOpeningGaps(pieces, [{ at: [340, 400], widthPx: 70 }], { tolerance: 10, maxGap: 200 })).toHaveLength(2);
    // A gap wider than a door is not bridged.
    expect(bridgeOpeningGaps(pieces, [{ at: [340, 100], widthPx: 70 }], { tolerance: 10, maxGap: 50 })).toHaveLength(2);
  });
});

describe('cleanWalls extension', () => {
  it('closes a corner where one wall stops short of the other', () => {
    // The vertical wall stops 25 px below the horizontal one: too far for the join step, near enough to extend.
    const cleaned = cleanWalls([wall(0, 0, 500, 0), wall(500, 25, 500, 500)], { tolerance: 12, minLength: 6 });
    const vertical = cleaned.find(w => w.a[0] === w.b[0])!;
    expect(Math.min(vertical.a[1], vertical.b[1])).toBeCloseTo(0, 3);
    expect(Math.max(vertical.a[1], vertical.b[1])).toBeCloseTo(500, 3);
  });
  it('does not extend a wall that already ends on another', () => {
    const cleaned = cleanWalls([wall(0, 0, 500, 0), wall(500, 0, 500, 400)], { tolerance: 12, minLength: 6 });
    expect(cleaned).toHaveLength(2);
    const horizontal = cleaned.find(w => w.a[1] === w.b[1])!;
    expect(Math.max(horizontal.a[0], horizontal.b[0])).toBeCloseTo(500, 3);
  });
});

describe('realisticOpeningWidth', () => {
  it('snaps doors to standard sizes and windows to 5 cm', () => {
    expect(realisticOpeningWidth('door', 0.87)).toBe(0.91);
    expect(realisticOpeningWidth('door', 1.3)).toBe(1.2);
    expect(realisticOpeningWidth('door', 1.7)).toBe(1.83);
    expect(realisticOpeningWidth('door', 0.2)).toBe(0.76);
    expect(realisticOpeningWidth('door', 5)).toBe(2.4);
    expect(realisticOpeningWidth('window', 1.234)).toBeCloseTo(1.25, 6);
  });
});

describe('recogniseFloorPlanWithAi scale check', () => {
  const rooms = [
    { name: 'A', x: 150, y: 150, x1: 100, y1: 100, x2: 200, y2: 200, printedSize: "16' x 16'" },
    { name: 'B', x: 350, y: 150, x1: 300, y1: 100, x2: 400, y2: 200, printedSize: "16' x 16'" },
    { name: 'C', x: 550, y: 150, x1: 500, y1: 100, x2: 600, y2: 200, printedSize: "16' x 16'" },
    { name: 'D', x: 750, y: 150, x1: 700, y1: 100, x2: 800, y2: 200, printedSize: "16' x 16'" },
  ];
  const walls = [{ x1: 100, y1: 100, x2: 800, y2: 100 }, { x1: 800, y1: 100, x2: 800, y2: 200 }, { x1: 800, y1: 200, x2: 100, y2: 200 }, { x1: 100, y1: 200, x2: 100, y2: 100 }];

  it('suggests the scale printed room sizes imply when the calibration is far off', async () => {
    // 100/1000 of a 1000 px image is 100 px = 16 ft = 4.877 m, so the true scale is 0.04877 m/px.
    const observation = await recogniseFloorPlanWithAi({
      imageDataUrl: '', imageSize: [1000, 1000], metresPerPixel: 0.1,
      generate: async () => JSON.stringify({ walls, openings: [], rooms }),
    });
    const suggestion = observation.scaleCheck?.suggestion;
    expect(suggestion?.basis).toBe('room sizes');
    expect(suggestion?.ratio).toBeCloseTo(0.4877, 3);
    expect(observation.uncertainties?.join(' ')).toMatch(/room sizes printed on the plan/);
  });

  it('says nothing when the calibration matches the printed sizes', async () => {
    const observation = await recogniseFloorPlanWithAi({
      imageDataUrl: '', imageSize: [1000, 1000], metresPerPixel: 0.048768,
      generate: async () => JSON.stringify({ walls, openings: [], rooms }),
    });
    expect(observation.scaleCheck?.warnings).toEqual([]);
  });
});

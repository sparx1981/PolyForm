import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Shape } from '../../types';
import { buildPose, buildSchedule, categoryOf, explodeLift, levelFor, lookAt, storeyElevations, EXPLODE_STOREY_GAP } from './classify';
import { billOfMaterials, bomToCsv, pathLength, polygonArea } from './bom';
import { floorPlans } from './floorPlans';
import { newShareId, shareIdFromPath, SHARE_ID_PATTERN } from './share';
import { pickVideoType, videoFileName } from './recorder';
import { PresentationEngine } from './engine';
import { barFraction, INITIAL_PRESENTATION, SKETCH_BAR_SHARE, stageFromBar } from './store';

const wall = (id: string, x: number, z: number, len: number, rotY: number, base = 0): Shape => ({
  id, type: 'wall', position: [x, base + 1.4, z], rotation: [0, rotY, 0], args: [len, 2.8, 0.2], color: '#fff',
});

/** A 6 × 4 m box of walls on the ground, and the same again a storey up. */
function house(): Shape[] {
  const storey = (base: number, p: string) => [
    wall(`${p}n`, 0, -2, 6.2, 0, base), wall(`${p}s`, 0, 2, 6.2, 0, base),
    wall(`${p}e`, 3, 0, 4.2, Math.PI / 2, base), wall(`${p}w`, -3, 0, 4.2, Math.PI / 2, base),
  ];
  return [
    ...storey(0, 'g'), ...storey(3, 'f'),
    { id: 'd1', type: 'door', position: [1, 1.05, 2], rotation: [0, 0, 0], args: [0.9, 2.1, 0.2], hostWallId: 'gs', color: '#000' },
    { id: 'w1', type: 'window', position: [-1, 1.5, -2], rotation: [0, 0, 0], args: [1.2, 1.2, 0.2], hostWallId: 'gn', color: '#000' },
    { id: 'slab', type: 'box', position: [0, -0.1, 0], args: [6, 0.2, 4], tags: ['floor-slab'], color: '#ccc' },
    { id: 'roof', type: 'roof', position: [0, 6, 0], args: [], roofData: { roofType: 'gable' }, color: '#900' },
    { id: 'oak', type: 'tree', position: [8, 0, 0], args: [], color: '#0a0', name: 'Tree' },
    { id: 'terrain', type: 'terrain', position: [0, 0, 0], args: [], color: '#0f0' },
    {
      id: 'patio', type: 'patio', position: [0, 0.05, 5], args: [], color: '#ccc',
      patioData: { kind: 'patio', points: [[0, 0], [4, 0], [4, 3], [0, 3]], bulges: [0, 0, 0, 0], wallEdges: [true, false, false, false], paving: 'slabs', kerb: true, railing: 'none' } as any,
    },
    {
      id: 'fence', type: 'fence', position: [0, 0, 8], args: [], color: '#963',
      fenceData: { points: [[0, 0], [3, 0], [3, 4]], style: 'close-board', height: 1.8, seed: 1 } as any,
    },
  ];
}

describe('classify', () => {
  it('sorts objects into presentation categories', () => {
    const s = house();
    const cat = (id: string) => categoryOf(s.find(x => x.id === id));
    expect([cat('gn'), cat('d1'), cat('slab'), cat('roof'), cat('oak'), cat('terrain'), cat('patio')])
      .toEqual(['wall', 'opening', 'slab', 'roof', 'landscape', 'terrain', 'landscape']);
    expect(categoryOf(undefined)).toBe('kernel');
    // A roof assembly's parts are separate custom shapes, known by their tags.
    const part = (tags: string[]) => categoryOf({ id: 'r', type: 'custom', position: [0, 0, 0], args: [], color: '', tags });
    expect(part(['architecture', 'roof-structure', 'roof-assembly', 'roof-slopes'])).toBe('roof');
    expect(part(['architecture', 'roof-fascia', 'roof-part'])).toBe('roof');
    expect(part(['architecture', 'slab', 'floor', 'story-2'])).toBe('slab');
    expect(part(['timber-frame', 'roof-truss'])).toBe('roofFrame');
    expect(part(['timber-frame', 'timber-stud'])).toBe('frame');
    expect(part(['timber-frame', 'timber-floor-joist'])).toBe('floorFrame');
    expect(part(['timber-frame', 'timber-ceiling-joist'])).toBe('roofFrame');
  });

  it('finds storeys from wall bases', () => {
    expect(storeyElevations(house())).toEqual([0, 3]);
    expect(levelFor(3.05, [0, 3])).toBe(1);
    expect(levelFor(2.2, [0, 3])).toBe(0);
    expect(levelFor(-0.2, [0, 3])).toBe(0);
  });

  it('lifts upper storeys and the roof furthest when exploded; the garden stays put', () => {
    expect(explodeLift('wall', 0, 2)).toBeGreaterThan(0);
    expect(explodeLift('slab', 0, 2)).toBe(0);
    expect(explodeLift('wall', 1, 2)).toBeGreaterThan(EXPLODE_STOREY_GAP);
    expect(explodeLift('roof', 1, 2)).toBeGreaterThan(explodeLift('wall', 1, 2));
    expect(explodeLift('landscape', 0, 2)).toBe(0);
  });

  it('puts the timber frame up before the walls and roof close over it', () => {
    const plan = buildSchedule([
      { key: 'joists', category: 'floorFrame', level: 1, x: 0, z: 0 },
      { key: 'slab0', category: 'slab', level: 0, x: 0, z: 0 },
      { key: 'studs0', category: 'frame', level: 0, x: 0, z: 0 },
      { key: 'wall0', category: 'wall', level: 0, x: 0, z: 0 },
      { key: 'slab1', category: 'slab', level: 1, x: 0, z: 0 },
      { key: 'studs1', category: 'frame', level: 1, x: 0, z: 0 },
      { key: 'wall1', category: 'wall', level: 1, x: 0, z: 0 },
      { key: 'rafters', category: 'roofFrame', level: 1, x: 0, z: 0 },
      { key: 'roof', category: 'roof', level: 1, x: 0, z: 0 },
    ]);
    const order = ['slab0', 'studs0', 'wall0', 'joists', 'slab1', 'studs1', 'wall1', 'rafters', 'roof'].map(k => plan.get(k)!.start);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('lifts roof timbers with the roof and floor joists with their slab when exploded', () => {
    expect(explodeLift('roofFrame', 1, 2)).toBe(explodeLift('roof', 1, 2));
    expect(explodeLift('floorFrame', 1, 2)).toBe(explodeLift('slab', 1, 2));
  });

  it('builds storey by storey, roof after walls, garden last', () => {
    const plan = buildSchedule([
      { key: 'garden', category: 'landscape', level: 0, x: 5, z: 0 },
      { key: 'roof', category: 'roof', level: 1, x: 0, z: 0 },
      { key: 'up', category: 'wall', level: 1, x: 0, z: 0 },
      { key: 'slab', category: 'slab', level: 0, x: 0, z: 0 },
      { key: 'wall', category: 'wall', level: 0, x: 1, z: 0 },
      { key: 'ground', category: 'terrain', level: 0, x: 0, z: 0 },
    ]);
    const order = ['slab', 'wall', 'up', 'roof', 'garden'].map(k => plan.get(k)!.start);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(plan.get('ground')).toEqual({ start: 0, span: 0 });
    const last = plan.get('garden')!;
    expect(last.start + last.span).toBeCloseTo(1);
  });

  it('hides an item before its turn and drops it into place', () => {
    const slot = { start: 0.5, span: 0.2 };
    expect(buildPose(slot, 0.4, 'wall').visible).toBe(false);
    const mid = buildPose(slot, 0.6, 'wall');
    expect(mid.visible).toBe(true);
    expect(mid.drop).toBeGreaterThan(0);
    expect(buildPose(slot, 0.8, 'wall')).toEqual({ visible: true, drop: 0, scale: 1 });
    expect(buildPose(slot, 0.6, 'landscape').scale).toBeGreaterThan(0);
  });
});

describe('look stages', () => {
  it('goes from pencil on paper to the built model', () => {
    const sketch = lookAt(0), massing = lookAt(1), detailed = lookAt(2), built = lookAt(3);
    expect(sketch).toMatchObject({ mode: 'clay', whiteness: 0, glass: false, furniture: false, plants: false, paper: 1 });
    expect(sketch.pencil).toBeGreaterThan(massing.pencil);
    expect(massing).toMatchObject({ mode: 'clay', whiteness: 1, glass: false });
    expect(detailed).toMatchObject({ mode: 'clay', glass: true, furniture: true, plants: false, treeSketch: 1 });
    expect(built).toMatchObject({ mode: 'built', pencil: 0, plants: true, treeSketch: 0, paper: 0 });
    // Between Detailed and Built the real materials fade in under the model layer.
    expect(lookAt(2.5)).toMatchObject({ mode: 'fade', clayOver: 0.5 });
    expect(lookAt(-1)).toEqual(sketch);
    expect(lookAt(9)).toEqual(built);
  });
});

describe('stage transitions', () => {
  it('brings glass, furniture and plants in gradually rather than switching them on', () => {
    for (const key of ['glassIn', 'furnitureIn', 'plantsIn'] as const) {
      let last = lookAt(0)[key];
      for (let s = 0.05; s <= 3; s += 0.05) {
        const now = lookAt(s)[key];
        expect(now).toBeGreaterThanOrEqual(last);
        // No single step of 0.05 of a stage jumps more than a fifth of the way.
        expect(now - last).toBeLessThan(0.2);
        last = now;
      }
      expect(lookAt(3)[key]).toBe(1);
    }
    expect(lookAt(1.6).furnitureIn).toBeGreaterThan(0);
    expect(lookAt(1.6).furnitureIn).toBeLessThan(1);
    expect(lookAt(2.6).plantsIn).toBeGreaterThan(0);
    expect(lookAt(2.6).plantsIn).toBeLessThan(1);
  });

  it('moves the timeline bar while the pencil draws, and never backwards into the stages', () => {
    expect(barFraction(0, 0)).toBe(0);
    expect(barFraction(0, 0.5)).toBeCloseTo(SKETCH_BAR_SHARE / 2);
    expect(barFraction(0, 1)).toBeCloseTo(SKETCH_BAR_SHARE);
    // Drawing finished and the stages begin: the bar carries on from where the drawing left it.
    expect(barFraction(0.03, 1)).toBeGreaterThanOrEqual(barFraction(0, 1));
    expect(barFraction(3, 1)).toBe(1);
    let last = -1;
    for (let s = 0; s <= 3; s += 0.1) { const f = barFraction(s, 1); expect(f).toBeGreaterThanOrEqual(last); last = f; }
    // Clicking the bar gives back the stage under it.
    for (const stage of [0.5, 1, 2, 2.9]) expect(stageFromBar(barFraction(stage, 1))).toBeCloseTo(stage);
    expect(stageFromBar(0.02)).toBe(0);
  });
});

describe('bill of materials', () => {
  it('measures polygons and paths', () => {
    expect(polygonArea([[0, 0], [4, 0], [4, 3], [0, 3]])).toBe(12);
    expect(pathLength([[0, 0], [3, 0], [3, 4]])).toBe(7);
    expect(pathLength([[0, 0], [3, 0], [3, 4]], true)).toBe(12);
  });

  it('counts the building and the garden', () => {
    const lines = billOfMaterials(house(), { measured: { roof: { topArea: 52.34 }, slab: { topArea: 24 } } });
    const find = (item: string, detail?: string) => lines.find(l => l.item === item && (detail === undefined || l.detail === detail));
    // 8 walls: 4 × 6.2 + 4 × 4.2 = 41.6 m run; area 41.6 × 2.8 less a door and a window.
    expect(find('Wall length')!.qty).toBeCloseTo(41.6, 1);
    expect(find('Walls')!.qty).toBeCloseTo(41.6 * 2.8 - 0.9 * 2.1 - 1.2 * 1.2, 0);
    expect(find('Doors')!.detail).toBe('900 × 2100 mm');
    expect(find('Windows')!.qty).toBe(1);
    expect(find('Floor slabs')!.qty).toBe(24);
    expect(find('Roof covering')!).toMatchObject({ qty: 52.3, detail: 'Gable roof', unit: 'm²' });
    expect(find('Patio')!).toMatchObject({ qty: 12, unit: 'm²' });
    expect(find('Kerb edging')!.qty).toBe(14);
    expect(find('Fencing')!).toMatchObject({ qty: 7, unit: 'm', detail: 'Close Board, 1.8 m high' });
    expect(find('Trees')!.qty).toBe(1);
    expect(lines[0].group).toBe('Structure');
    // Roof trim (ridge cap, fascias) is part of the roof, not another roof.
    const trim: Shape = { id: 'trim', type: 'custom', position: [0, 6, 0], args: [], color: '', tags: ['roof-fascia', 'roof-part'] };
    expect(billOfMaterials([...house(), trim]).filter(l => l.item === 'Roofs' || l.item === 'Roof covering')).toHaveLength(1);
  });

  it('writes a spreadsheet with quoted cells where needed', () => {
    const csv = bomToCsv([{ group: 'Landscape', item: 'Fencing', detail: 'Picket, 1.2 m high', qty: 7, unit: 'm' }]);
    expect(csv.split('\n')[1]).toBe('Landscape,Fencing,"Picket, 1.2 m high",7,m');
  });
});

describe('floor plans for the client page', () => {
  it('tags doors and windows and lists them', () => {
    const [ground, first] = floorPlans(house(), [], 1000, { openingTags: true, wallDimensions: true });
    expect(ground.openings.map(o => o.mark).sort()).toEqual(['D1', 'W1']);
    const w = ground.openings.find(o => o.kind === 'window')!;
    expect(w).toMatchObject({ width: 1.2, height: 1.2, sill: 0.9, level: 1 });
    expect(first.openings).toEqual([]);
    expect(ground.svg).toContain('>D1<');
    // Outside walls get their lengths written beside them.
    expect(ground.svg).toContain('>6.20<');
  });

  it('gives each room a spot that names it when passed back', () => {
    const [ground] = floorPlans(house());
    expect(ground.rooms).toHaveLength(1);
    const again = floorPlans(house(), [{ level: 1, at: ground.rooms[0].at, name: 'Studio' }]);
    expect(again[0].rooms[0].name).toBe('Studio');
  });

  it('draws an illustrated plan with the garden around the house', () => {
    const [ground] = floorPlans(house(), [], 1000, { style: 'artistic', axisNote: false });
    expect(ground.svg).toContain('url(#canopy)');
    expect(ground.svg).toContain('url(#paving)');
    expect(ground.svg).not.toContain('x →');
  });

  it('escapes room names', () => {
    const [ground] = floorPlans(house());
    const named = floorPlans(house(), [{ level: 1, at: ground.rooms[0].at, name: '<b>"Den"</b>' }]);
    expect(named[0].svg).toContain('&lt;b&gt;&quot;Den&quot;&lt;/b&gt;');
  });
});

describe('share links', () => {
  it('makes unguessable ids that round-trip through the path', () => {
    const id = newShareId();
    expect(id).toMatch(SHARE_ID_PATTERN);
    expect(id).toHaveLength(22);
    expect(newShareId()).not.toBe(id);
    expect(shareIdFromPath(`/p/${id}`)).toBe(id);
    expect(shareIdFromPath(`/p/${id}/`)).toBe(id);
    expect(shareIdFromPath('/p/short')).toBeNull();
    expect(shareIdFromPath('/app')).toBeNull();
  });
});

describe('video recording', () => {
  it('prefers MP4, falls back to WebM', () => {
    expect(pickVideoType(t => t.startsWith('video/mp4'))).toMatch(/^video\/mp4/);
    expect(pickVideoType(t => t === 'video/webm')).toBe('video/webm');
    expect(pickVideoType(() => false)).toBe('');
    expect(videoFileName('My House!', 'video/mp4')).toBe('my-house-presentation.mp4');
    expect(videoFileName(null, 'video/webm')).toBe('polyform-presentation.webm');
  });
});

describe('presentation engine', () => {
  function scene(shapes: Shape[]) {
    const s = new THREE.Scene();
    for (const shape of shapes) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
      mesh.position.set(...shape.position);
      mesh.userData = { isShape: true, id: shape.id };
      s.add(mesh);
    }
    return s;
  }
  const byId = (s: THREE.Scene, id: string) => s.children.find(o => o.userData.id === id) as THREE.Mesh;

  it('explodes, x-rays and cuts, then puts everything back', () => {
    const shapes = house();
    const s = scene(shapes);
    const e = new PresentationEngine(s);
    e.sync(shapes);
    const upper = byId(s, 'fn');
    const tree = byId(s, 'oak');
    const y0 = upper.position.y;
    const wallMat = byId(s, 'gn').material;

    const on = { ...INITIAL_PRESENTATION, active: true, explode: 1 };
    for (let i = 0; i < 200; i++) e.update(on, 0.05);
    expect(upper.position.y).toBeGreaterThan(y0 + EXPLODE_STOREY_GAP);
    expect(tree.position.y).toBe(0);

    e.update({ ...on, xray: true, cut: 'plan', cutAt: 1.2 }, 0.05);
    expect(byId(s, 'gn').material).not.toBe(wallMat);
    expect((byId(s, 'gn').material as THREE.Material).transparent).toBe(true);
    // Furniture and garden stay solid; the stair-less garden isn't cut.
    expect(tree.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect((tree.material as THREE.Material).clippingPlanes ?? null).toBeNull();

    // An invisible hit target inside a wall stays invisible.
    const target = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }));
    byId(s, 'gs').add(target);
    const targetMat = target.material;
    e.update({ ...on, xray: true, cut: 'off' }, 0.05);
    for (let i = 0; i < 40; i++) e.update({ ...on, xray: true, cut: 'off' }, 0.05);
    expect(target.material).toBe(targetMat);

    const off = { ...INITIAL_PRESENTATION, active: false };
    for (let i = 0; i < 200; i++) e.update(off, 0.05);
    expect(upper.position.y).toBeCloseTo(y0);
    expect(byId(s, 'gn').material).toBe(wallMat);
    expect(byId(s, 'gn').children).toHaveLength(0);
    expect(byId(s, 'gs').children).toEqual([target]);
  });

  it('follows a move made while presenting', () => {
    const shapes = house();
    const s = scene(shapes);
    const e = new PresentationEngine(s);
    e.sync(shapes);
    const w = byId(s, 'gn');
    const on = { ...INITIAL_PRESENTATION, active: true, explode: 1 };
    for (let i = 0; i < 100; i++) e.update(on, 0.05);
    // React re-renders the wall at a new place (an edit); that becomes its resting position.
    w.position.set(10, 1.4, 10);
    for (let i = 0; i < 200; i++) e.update({ ...on, explode: 0 }, 0.05);
    expect(w.position.toArray()).toEqual([10, 1.4, 10]);
  });

  it('shows the white model with pencil lines, hides furniture and trees, then restores', () => {
    const shapes: Shape[] = [...house(), { id: 'sofa', type: 'box', position: [1, 0.4, 1], args: [2, 0.8, 0.9], color: '#933' }];
    const s = scene(shapes);
    const e = new PresentationEngine(s);
    e.sync(shapes);
    const w = byId(s, 'gn'), sofa = byId(s, 'sofa'), tree = byId(s, 'oak');
    const wallMat = w.material;
    const massing = { ...INITIAL_PRESENTATION, active: true, stage: 1 };
    for (let i = 0; i < 60; i++) e.update(massing, 0.05);
    expect(w.material).not.toBe(wallMat);
    expect(w.children.some(c => (c as THREE.LineSegments).isLineSegments)).toBe(true);
    expect(sofa.visible).toBe(false);
    expect(tree.visible).toBe(false);
    // Pencil outlines of the trees stand in for them.
    expect(s.children.some(c => c.userData.presentationAux && c.children.length > 0)).toBe(true);
    expect(s.background).not.toBeNull();

    for (let i = 0; i < 80; i++) e.update({ ...massing, stage: 3 }, 0.05);
    expect(w.material).toBe(wallMat);
    expect(w.children).toHaveLength(0);
    expect(sofa.visible).toBe(true);
    expect(tree.visible).toBe(true);
    expect(s.background).toBeNull();
  });

  it('dims the sun and lights the rooms at dusk, then puts the daylight back', () => {
    const shapes = house();
    const s = scene(shapes);
    const sun = new THREE.DirectionalLight('#ffffff', 2);
    s.add(sun);
    const e = new PresentationEngine(s);
    e.sync(shapes);
    for (let i = 0; i < 100; i++) e.update({ ...INITIAL_PRESENTATION, active: true, dusk: true }, 0.05);
    expect(sun.intensity).toBeLessThan(0.5);
    let roomLights = 0;
    s.traverse(o => { if ((o as THREE.PointLight).isPointLight && (o as THREE.PointLight).intensity > 0) roomLights++; });
    expect(roomLights).toBe(2);
    for (let i = 0; i < 200; i++) e.update({ ...INITIAL_PRESENTATION, active: true }, 0.05);
    expect(sun.intensity).toBe(2);
    expect(sun.color.getHexString()).toBe('ffffff');
    let left = 0;
    s.traverse(o => { if ((o as THREE.PointLight).isPointLight) left++; });
    expect(left).toBe(0);
  });

  it('hides everything but the ground at the start of a build', () => {
    const shapes = house();
    const s = scene(shapes);
    const e = new PresentationEngine(s);
    e.sync(shapes);
    e.update({ ...INITIAL_PRESENTATION, active: true, build: 0 }, 0.016);
    expect(byId(s, 'terrain').visible).toBe(true);
    expect(byId(s, 'gn').visible).toBe(false);
    e.update({ ...INITIAL_PRESENTATION, active: true, build: 1 }, 0.016);
    expect(byId(s, 'gn').visible).toBe(true);
  });
});

describe('presentation content (labels and tour)', () => {
  it('keeps well-formed labels and stops and drops the rest', async () => {
    const { normalizePresentationContent } = await import('./content');
    const good = {
      labels: [{ id: 'a', text: 'Patio', position: [1, 0, 2] }, { id: 'b', text: 'Bad', position: [1, 'x', 2] }, null],
      tour: [{ id: 't', title: 'Arrive', position: [5, 3, 5], target: [0, 1, 0], caption: 'Hello' }, { id: 'u', title: 'No target', position: [1, 1, 1] }],
    };
    const c = normalizePresentationContent(good);
    expect(c.labels.map(l => l.id)).toEqual(['a']);
    expect(c.tour.map(t => t.id)).toEqual(['t']);
    expect(normalizePresentationContent(undefined)).toEqual({ labels: [], tour: [] });
    expect(normalizePresentationContent('nonsense')).toEqual({ labels: [], tour: [] });
  });

  it('round-trips through a project file', async () => {
    const { buildProjectFile, parseProjectFile } = await import('../storage/projectFile');
    const content = { labels: [{ id: 'a', text: 'Patio', position: [1, 0, 2] }], tour: [] };
    const text = buildProjectFile({ shapes: [], tags: [], scenes: [], customMaterials: [], animations: [], notes: [], customLights: [], terrainModifiers: [], presentationContent: content });
    expect(parseProjectFile(text).presentationContent).toEqual(content);
  });
});

describe('client comments', () => {
  it('groups replies under their comment and counts what the designer has not read', async () => {
    const { threads, unreadCount } = await import('./comments');
    const c = (id: string, extra: object = {}) => ({ id, authorName: 'A', text: 't', createdAt: 1, fromDesigner: false, read: false, anchor: null, replyTo: null, ...extra });
    const all = [c('a'), c('b', { replyTo: 'a', fromDesigner: true, read: true }), c('c', { read: true }), c('d', { replyTo: 'gone' })];
    const t = threads(all);
    expect(t.map(x => [x.root.id, x.replies.map(r => r.id)])).toEqual([['a', ['b']], ['c', []], ['d', []]]);
    expect(unreadCount(all)).toBe(2);
  });
});

describe('clickable doors', () => {
  it('splits a door into frame and leaf, swings it open away from the viewer, and puts it back', async () => {
    const { createDoorGeometry } = await import('../archGeometry');
    const { DoorOpener, pieces, isFramePiece, doorMotion } = await import('./doors');
    const geo = createDoorGeometry(0.9, 2.1, 0.15, '4panel');
    const parts = pieces(geo);
    const frame = parts.filter(p => isFramePiece(p.box, 0.9, 2.1));
    expect(frame.length).toBe(1); // jambs and header, joined at the corners
    expect(parts.length).toBeGreaterThan(frame.length);

    const mesh = new THREE.Mesh(geo, [new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()]);
    mesh.updateMatrixWorld();
    const doors = new DoorOpener();
    const viewer = new THREE.Vector3(0, 1.5, 5); // in front (+z)
    doors.toggle(mesh, { width: 0.9, height: 2.1 }, '4panel', viewer);
    expect(mesh.geometry).not.toBe(geo);
    for (let i = 0; i < 30; i++) doors.update(0.05);
    const leaf = mesh.children[0];
    expect(Math.abs(leaf.rotation.y)).toBeGreaterThan(1.5);
    // The leaf's free edge has moved away from the viewer (to -z).
    const edge = new THREE.Vector3(0.8, 0, 0).applyEuler(leaf.rotation);
    expect(edge.z).toBeLessThan(0);
    expect(doors.isOpen(mesh)).toBe(true);

    doors.toggle(mesh, { width: 0.9, height: 2.1 }, '4panel', viewer);
    for (let i = 0; i < 30; i++) doors.update(0.05);
    expect(mesh.geometry).toBe(geo);
    expect(mesh.children).toHaveLength(0);

    expect(doorMotion('double-french')).toBe('double');
    expect(doorMotion('barn')).toBe('slide');
    expect(doorMotion('archway-round')).toBe('none');
  });

  it('opens both leaves of French doors and slides a barn door', async () => {
    const { createDoorGeometry } = await import('../archGeometry');
    const { DoorOpener } = await import('./doors');
    const french = new THREE.Mesh(createDoorGeometry(1.6, 2.1, 0.15, 'double-french'), new THREE.MeshStandardMaterial());
    const barn = new THREE.Mesh(createDoorGeometry(1.0, 2.1, 0.15, 'barn'), new THREE.MeshStandardMaterial());
    const doors = new DoorOpener();
    doors.toggle(french, { width: 1.6, height: 2.1 }, 'double-french', new THREE.Vector3(0, 1, 5));
    doors.toggle(barn, { width: 1.0, height: 2.1 }, 'barn', new THREE.Vector3(0, 1, 5));
    for (let i = 0; i < 30; i++) doors.update(0.05);
    expect(french.children).toHaveLength(2);
    expect(Math.sign(french.children[0].rotation.y)).toBe(-Math.sign(french.children[1].rotation.y));
    expect(barn.children[0].position.x).toBeGreaterThan(0.8);
    doors.dispose();
    expect(french.children).toHaveLength(0);
  });
});

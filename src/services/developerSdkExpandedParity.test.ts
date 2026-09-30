// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { DeveloperSDK } from './developerService';
import { KernelArcHost } from '../tools/kernelArcHost';
import { buildRoomAssembly } from '../lib/archRoomAssembly';
import { isSectionShape, type SectionArgs } from '../tools/sectionPlanes';
import { isGuideShape } from '../tools/tapeGuides';
import { checkIntegrity } from '../lib/geometry/topology';
import type { Shape, TerrainModifier } from '../types';

function harness(initial: Shape[] = [], extra: Record<string, any> = {}) {
  let shapes = [...initial];
  const setShapes = (next: Shape[] | ((prev: Shape[]) => Shape[])) => {
    shapes = typeof next === 'function' ? next(shapes) : next;
  };
  const sdk = new DeveloperSDK(shapes, setShapes, vi.fn(), null, { onLog: vi.fn(), ...extra });
  return { sdk, get shapes() { return shapes; } };
}

describe('expanded SDK tool coverage', () => {
  it.each([
    { justification: 'center' as const, width: 6, length: 4, height: 2.8, thickness: 0.2 },
    { justification: 'exterior' as const, width: 8, length: 5, height: 3.1, thickness: 0.3 },
    { justification: 'interior' as const, width: 3.6, length: 7.2, height: 2.4, thickness: 0.12 },
  ])('createRoom uses the shared Wall-tool assembly: $justification', args => {
    const pos: [number, number, number] = [2, 0.4, -3];
    const expected = buildRoomAssembly([
      new THREE.Vector3(pos[0] - args.width / 2, pos[1], pos[2] - args.length / 2),
      new THREE.Vector3(pos[0] + args.width / 2, pos[1], pos[2] - args.length / 2),
      new THREE.Vector3(pos[0] + args.width / 2, pos[1], pos[2] + args.length / 2),
      new THREE.Vector3(pos[0] - args.width / 2, pos[1], pos[2] + args.length / 2),
    ], null, undefined, {
      justification: args.justification,
      wallHeight: args.height,
      wallThickness: args.thickness,
      slabThickness: 0.2,
      story: 2,
      wallColor: '#f1f5f9',
      slabColor: '#94a3b8',
    });

    const h = harness([], { activeStory: 2 });
    const room = h.sdk.architecture.createRoom({
      width: args.width,
      length: args.length,
      height: args.height,
      wallThickness: args.thickness,
      justification: args.justification,
      story: 2,
      position: pos,
    });

    expect(room.wallShapes).toHaveLength(4);
    expect(room.wallShapes.map(w => w.args)).toEqual(expected.wallShapes.map(w => w.args));
    expect(room.wallShapes.map(w => w.position)).toEqual(expected.wallShapes.map(w => w.position));
    expect(room.wallShapes.every(w => w.wallMiterFootprint?.length === 4)).toBe(true);
    expect(room.floorShape?.type).toBe(expected.slabShape.type);
    expect(room.foundationShape).toBeDefined();
  });

  it('Follow Me SDK commits through the kernel tool path', () => {
    const host = new KernelArcHost({ upAxis: { x: 0, y: 1, z: 0 } });
    const h = harness([], { kernelHost: host, bumpKernel: vi.fn() });
    const [profile] = h.sdk.drawing.shape([
      [-0.2, 0, 0], [0.2, 0, 0], [0.2, 0.4, 0], [-0.2, 0.4, 0],
    ]);
    expect(profile).toBeDefined();
    expect(h.sdk.drawing.followMe(profile!, {
      points: [[0, 0, 0], [0, 0, 3], [3, 0, 3]],
      closed: false,
    })).toBe(true);
    expect(checkIntegrity(host.graph)).toEqual([]);
    expect(host.graph.faces.size).toBeGreaterThan(4);
  });

  it('creates and edits Section Plane state using the same saved section format', () => {
    const h = harness();
    const a = h.sdk.sections.create({ point: [0, 1.2, 0], normal: [0, 1, 0], size: 12, xrayOpacity: 0.4 });
    const b = h.sdk.sections.create({ point: [2, 0, 0], normal: [1, 0, 0], active: false });
    expect(isSectionShape(a)).toBe(true);
    expect(h.sdk.sections.list()).toHaveLength(2);

    h.sdk.sections.setActive(b.id);
    expect((h.shapes.find(s => s.id === b.id)!.args as SectionArgs).active).toBe(true);
    expect((h.shapes.find(s => s.id === a.id)!.args as SectionArgs).active).toBe(false);

    h.sdk.sections.move(b.id, 2);
    expect(h.shapes.find(s => s.id === b.id)!.position[0]).toBeCloseTo(4);
    h.sdk.sections.flip(b.id);
    expect((h.shapes.find(s => s.id === b.id)!.args as SectionArgs).normal).toEqual([-1, 0, 0]);
    h.sdk.sections.setLayerCut(b.id, 'ground', false);
    h.sdk.sections.update(b.id, { showPlane: false, xrayOpacity: 0.75 });
    expect((h.shapes.find(s => s.id === b.id)!.args as SectionArgs).showPlane).toBe(false);
    h.sdk.sections.remove(a.id);
    expect(h.sdk.sections.list()).toHaveLength(1);
  });

  it('creates dimensions, leaders and saved Tape Measure guides', () => {
    const h = harness();
    const d = h.sdk.measurement.addDimension([0, 0, 0], [4, 0, 0], { text: 'Grid A', offset: [0, 0.5, 0] });
    const leader = h.sdk.measurement.addLeader([2, 1, 0], [3, 2, 0], 'Beam');
    const guide = h.sdk.measurement.addGuide([0, 0, 2], [1, 0, 0], 2, 25);
    expect((d.args as any).kind).toBe('dimension');
    expect((leader.args as any).kind).toBe('leader');
    expect(isGuideShape(guide)).toBe(true);
    expect(h.sdk.measurement.listGuides()).toHaveLength(1);
    expect(h.sdk.measurement.deleteGuides()).toBe(1);
    expect(h.sdk.measurement.listGuides()).toHaveLength(0);
  });

  it('creates styled doors/windows and procedural scale figures', () => {
    const h = harness();
    const door = h.sdk.architecture.createDoor({ style: 'double-french', rotation: [0, Math.PI / 2, 0], hostWallId: 'wall-1' });
    const window = h.sdk.architecture.createWindow({ style: 'porthole', hostWallId: 'wall-1' });
    const figure = h.sdk.architecture.createScaleFigure({ characterId: 'engineer-sam', height: 1.9, rotation: 0.3 });
    expect(door.archStyle).toBe('double-french');
    expect(door.hostWallId).toBe('wall-1');
    expect(window.archStyle).toBe('porthole');
    expect(figure.type).toBe('scale_figure');
    expect((figure.args as number[])[1]).toBeCloseTo(1.9);
    expect(h.sdk.architecture.listScaleFigureCharacters().length).toBeGreaterThan(3);
  });

  it('persists civil roads, pads and parking striping through terrain modifier state', () => {
    let terrainModifiers: TerrainModifier[] = [];
    const setTerrainModifiers = vi.fn((next: TerrainModifier[]) => { terrainModifiers = next; });
    const h = harness([], {
      terrainModifiers,
      setTerrainModifiers,
      civilRoadSettings: { width: 6, maxGradePercent: 8, hasCurb: true, curbWidth: 0.15, curbHeight: 0.15, hasDitch: false, ditchWidth: 1.2, ditchDepth: 0.35, markings: 'center-dashed', material: 'asphalt-weathered' },
      civilPadSettings: { primitive: 'rectangle', batterDistance: 3, batterProfile: 'linear', targetElevation: 1.5, dimensions: [18, 12] },
      civilStripingSettings: { angle: 90, stallWidth: 2.7, stallDepth: 5.5, stripeColor: '#FFFFFF', doubleRow: false },
    });

    const road = h.sdk.civil.addRoad({ points: [[0, 0, 0], [12, 0.2, 0], [20, 0.6, 5]], width: 7, markings: 'bike-lanes' });
    const pad = h.sdk.civil.addPad({ center: [8, 1.2, 8], dimensions: [20, 14], rotationY: 0.2 });
    h.sdk.civil.setPadSurface(pad.id, { pattern: 'parking-striping', parkingConfig: { angle: 60, doubleRow: true } });
    expect(h.sdk.civil.list()).toHaveLength(2);
    expect(road.width).toBe(7);
    const updatedPad = h.sdk.civil.list().find(m => m.id === pad.id && m.type === 'pad') as any;
    expect(updatedPad.surfaceModifier.parkingConfig.angle).toBe(60);
    expect(updatedPad.surfaceModifier.parkingConfig.doubleRow).toBe(true);
    h.sdk.civil.update(road.id, { enabled: false } as any);
    expect(h.sdk.civil.list().find(m => m.id === road.id)?.enabled).toBe(false);
    h.sdk.civil.remove(pad.id);
    expect(h.sdk.civil.list()).toHaveLength(1);
  });

  it('edits existing water flow and patio settings rather than requiring raw object mutation', () => {
    const h = harness();
    const pond = h.sdk.landscape.addPond([[0, 0], [8, 0], [8, 2], [0, 2]], { depth: 0.8 });
    h.sdk.landscape.updatePond(pond.id, { flow: { mode: 'stream', direction: [1, 0.2], speed: 0.7, turbulence: 0.35 }, clarity: 'clear', level: 0.3 });
    const water = h.shapes.find(s => s.id === pond.id)!;
    expect(water.waterData?.flow?.mode).toBe('stream');
    expect(water.waterData?.flow?.speed).toBeCloseTo(0.7);
    expect(water.position[1]).toBeCloseTo(0.3);

    const patio = h.sdk.landscape.addPatio([[0, 0], [5, 0], [5, 4], [0, 4]], { level: 0.1 });
    h.sdk.landscape.updatePatio(patio.id, { settings: { railing: 'glass', lights: { enabled: true, spacing: 1.2 } }, steps: [{ edge: 1, t: 0.5, width: 1.1 }] });
    const edited = h.shapes.find(s => s.id === patio.id)!;
    expect(edited.patioData?.railing).toBe('glass');
    expect(edited.patioData?.lights.enabled).toBe(true);
    expect(edited.patioData?.steps).toHaveLength(1);
  });

  it('controls navigation modes and Walk settings through the real application setters', () => {
    const setActiveTool = vi.fn();
    const setWalkMovementSpeed = vi.fn();
    const setWalkMouseSensitivity = vi.fn();
    const h = harness([], {
      setActiveTool,
      walkMovementSpeed: 3.2,
      setWalkMovementSpeed,
      walkMouseSensitivity: 0.7,
      setWalkMouseSensitivity,
    });
    h.sdk.camera.setNavigationMode('walk');
    h.sdk.camera.configureWalk({ movementSpeed: 4.1, mouseSensitivity: 0.55 });
    expect(setActiveTool).toHaveBeenCalledWith('walk');
    expect(setWalkMovementSpeed).toHaveBeenCalledWith(4.1);
    expect(setWalkMouseSensitivity).toHaveBeenCalledWith(0.55);
    expect(h.sdk.camera.getWalkSettings()).toEqual({ movementSpeed: 3.2, mouseSensitivity: 0.7 });
  });
});

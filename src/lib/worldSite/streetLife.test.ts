import { describe, expect, it } from 'vitest';
import type { SiteRoute } from '../../types';
import { clipToSquare, drivesOnLeft, lineLength, parseStreets, streetsQuery } from './streets';
import { gait, makeLoop, offsetLine, planStreetLife, pointOnLoop } from './streetLife';
import { localToLatLng } from './geo';

const origin = { lat: 51.1544, lng: 0.8417 };
const way = (id: number, tags: Record<string, string>, pts: [number, number][]) => ({
  type: 'way', id, tags, geometry: pts.map(([x, z]) => { const p = localToLatLng(origin, x, z); return { lat: p.lat, lon: p.lng }; }),
});

describe('streets from the map', () => {
  it('asks for every highway in the site and a margin', () => {
    const q = streetsQuery(origin, 100);
    expect(q).toMatch(/^\[out:json\]/);
    expect(q).toContain('way["highway"]');
  });

  it('keeps roads and footpaths, cut to the site, and drops what cars and people don\'t use', () => {
    const routes = parseStreets({
      elements: [
        way(1, { highway: 'residential' }, [[-80, 0], [80, 0]]),
        way(2, { highway: 'footway' }, [[0, -30], [0, 30]]),
        way(3, { highway: 'primary', oneway: 'yes' }, [[-40, 20], [40, 20]]),
        way(4, { highway: 'service', service: 'parking_aisle' }, [[0, 10], [20, 10]]),
        way(5, { highway: 'construction' }, [[0, 10], [20, 10]]),
        way(6, { highway: 'footway', tunnel: 'yes' }, [[0, 10], [20, 10]]),
        way(7, { highway: 'motorway' }, [[-40, -40], [40, -40]]),
      ],
    }, origin, 100);
    expect(routes.map(r => r.id)).toEqual(['osm-way-1', 'osm-way-2', 'osm-way-3', 'osm-way-7']);
    const road = routes[0]!;
    expect(road.kind).toBe('road');
    expect(road.width).toBe(6);
    // Cut at the site's edge (50 m each way).
    expect(road.points[0]![0]).toBeCloseTo(-50, 1);
    expect(road.points[road.points.length - 1]![0]).toBeCloseTo(50, 1);
    expect(routes[1]!.kind).toBe('path');
    expect(routes[2]!.oneway).toBe(true);
    expect(routes[3]!.noPavement).toBe(true);
  });

  it('cuts a line that leaves and comes back into separate pieces', () => {
    const parts = clipToSquare([[-10, 0], [30, 0], [30, 5], [-10, 5]], 20);
    expect(parts).toHaveLength(2);
    expect(lineLength(parts[0]!)).toBeCloseTo(30);
    expect(lineLength(parts[1]!)).toBeCloseTo(30);
  });

  it('knows which side of the road traffic keeps to', () => {
    expect(drivesOnLeft({ lat: 51.5, lng: -0.1 })).toBe(true); // London
    expect(drivesOnLeft({ lat: 35.7, lng: 139.7 })).toBe(true); // Tokyo
    expect(drivesOnLeft({ lat: -33.9, lng: 151.2 })).toBe(true); // Sydney
    expect(drivesOnLeft({ lat: 52.37, lng: 4.9 })).toBe(false); // Amsterdam
    expect(drivesOnLeft({ lat: 40.7, lng: -74 })).toBe(false); // New York
    expect(drivesOnLeft({ lat: 16.8, lng: 96.2 })).toBe(false); // Yangon
  });
});

describe('street life plan', () => {
  const road: SiteRoute = { id: 'r', kind: 'road', points: [[-50, 0], [50, 0]], source: 'map', width: 6 };
  const path: SiteRoute = { id: 'p', kind: 'path', points: [[0, -50], [0, 50]], source: 'drawn' };

  it('offsets a line to the right of travel', () => {
    // Heading east (+x), right is south (+z).
    expect(offsetLine([[0, 0], [10, 0]], 2)).toEqual([[0, 2], [10, 2]]);
  });

  it('goes round a loop and wraps', () => {
    const loop = makeLoop([[0, 0], [10, 0], [10, 10], [0, 10]]);
    expect(loop.length).toBe(40);
    expect(pointOnLoop(loop, 15)).toMatchObject({ x: 10, z: 5, dx: 0, dz: 1 });
    expect(pointOnLoop(loop, 45)).toMatchObject({ x: 5, z: 0 });
  });

  it('drives on the left in left-hand countries and on the right elsewhere', () => {
    const left = planStreetLife([road], { level: 'busy', leftHand: true });
    const right = planStreetLife([road], { level: 'busy', leftHand: false });
    // The first half of the loop heads east (+x): on the left of that is north (-z).
    expect(pointOnLoop(left.carLoops[0]!, 10).z).toBeLessThan(0);
    expect(pointOnLoop(right.carLoops[0]!, 10).z).toBeGreaterThan(0);
  });

  it('scales with how busy it is, fewer on phones, none when off', () => {
    const routes = [road, path];
    const quiet = planStreetLife(routes, { level: 'quiet', leftHand: true });
    const busy = planStreetLife(routes, { level: 'busy', leftHand: true });
    const phone = planStreetLife(routes, { level: 'busy', leftHand: true, small: true });
    const off = planStreetLife(routes, { level: 'off', leftHand: true });
    const people = (p: typeof busy) => p.walkers.length + p.standers.length + p.sitters.length;
    expect(busy.cars.length).toBeGreaterThan(quiet.cars.length);
    expect(people(busy)).toBeGreaterThan(people(quiet));
    expect(people(phone)).toBeLessThan(people(busy));
    expect(people(off) + off.cars.length).toBe(0);
    // A road gives pavements either side, and the path its own loop.
    expect(busy.walkLoops).toHaveLength(3);
  });

  it('keeps cars on one loop spaced out and at one speed', () => {
    const plan = planStreetLife([road], { level: 'busy', leftHand: true, seed: 7 });
    const loop = plan.carLoops[0]!;
    const starts = plan.cars.map(c => ((c.start % loop.length) + loop.length) % loop.length).sort((a, b) => a - b);
    for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(13.9);
    expect(new Set(plan.cars.map(c => c.speed)).size).toBe(1);
  });

  it('seats people on benches and is the same every time for a seed', () => {
    const seats = [{ x: 1, y: 0.46, z: 2, yaw: 0 }];
    const a = planStreetLife([path], { level: 'normal', leftHand: true, seats, seed: 3 });
    const b = planStreetLife([path], { level: 'normal', leftHand: true, seats, seed: 3 });
    expect(a.sitters).toHaveLength(1);
    expect(a).toEqual(b);
  });

  it('swings legs and arms opposite each other', () => {
    const g = gait(0.35);
    expect(g.leftLeg).toBeCloseTo(-g.rightLeg);
    expect(Math.sign(g.leftArm)).toBe(-Math.sign(g.leftLeg));
  });
});

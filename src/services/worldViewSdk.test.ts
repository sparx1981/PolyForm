// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { DeveloperSDK } from './developerService';
import type { Shape } from '../types';
import type { SiteIO } from '../lib/worldSite/site';
import { localToLatLng } from '../lib/worldSite/geo';

const origin = { lat: 51.5, lng: -0.12 };

/** A square house `w` metres wide centred `cx, cz` metres from the origin, as Overpass sends it. */
function house(id: number, cx: number, cz: number, w = 10) {
  const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([a, b]) => localToLatLng(origin, cx + (a * w) / 2, cz + (b * w) / 2));
  return { type: 'way', id, tags: { building: 'house' }, geometry: pts.map(p => ({ lat: p.lat, lon: p.lng })) };
}

/** A street `x0..x1` metres east along `cz` metres south. */
function street(id: number, tags: Record<string, string>, x0: number, x1: number, cz: number) {
  const pts = [localToLatLng(origin, x0, cz), localToLatLng(origin, x1, cz)];
  return { type: 'way', id, tags, geometry: pts.map(p => ({ lat: p.lat, lon: p.lng })) };
}

const siteIO: SiteIO = {
  heightTiles: async tiles => tiles.map(t => ({ ...t, heights: new Float32Array(256 * 256).fill(12) })),
  overpass: async q => (q.includes('"highway"')
    ? { elements: [street(10, { highway: 'residential' }, -60, 60, 20), street(11, { highway: 'footway' }, -30, 30, -20)] }
    : { elements: [house(1, 0, 0), house(2, 30, 0)] }),
};

function harness(initial: Shape[] = []) {
  let shapes = initial;
  const setShapes = vi.fn((next: Shape[] | ((prev: Shape[]) => Shape[])) => { shapes = typeof next === 'function' ? next(shapes) : next; });
  const setWorldViewLocation = vi.fn();
  const setIsWorldViewActive = vi.fn();
  const sdk = () => new DeveloperSDK(shapes, setShapes, vi.fn(), null, { siteIO, setWorldViewLocation, setIsWorldViewActive });
  return { get shapes() { return shapes; }, sdk, setWorldViewLocation, setIsWorldViewActive };
}

describe('sdk.worldView sites', () => {
  it('imports ground and buildings from coordinates, and lists the buildings', async () => {
    const h = harness([{ id: 'mine', type: 'box', position: [0, 0.5, 0], args: [1, 1, 1], color: '#fff' }]);
    const result = await h.sdk().worldView.importArea(origin, { size: 80 });
    expect(result).toMatchObject({ size: 80, buildings: 2, warnings: [] });
    expect(h.shapes.map(s => s.id)).toEqual(['site-ground', 'mine', 'site-way-1', 'site-way-2']);
    expect(h.setWorldViewLocation).toHaveBeenCalledWith(expect.objectContaining({ lat: 51.5, lng: -0.12 }));
    expect(h.setIsWorldViewActive).toHaveBeenCalledWith(false);
    const sdk = h.sdk();
    expect(sdk.worldView.getSite()).toMatchObject({ size: 80, elevation: 12, groundStyle: 'satellite' });
    expect(sdk.worldView.listBuildings().map((b: { id: string; height: number }) => [b.id, b.height])).toEqual([['site-way-1', 6], ['site-way-2', 6]]);
  });

  it('removes, ghosts, restores and re-heights buildings, and sets the ground style', async () => {
    const h = harness();
    await h.sdk().worldView.importArea(origin, { size: 80 });
    expect(h.sdk().worldView.removeBuilding('site-way-2')).toBe(true);
    expect(h.sdk().worldView.removeBuilding('mine')).toBe(false);
    expect(h.shapes.some(s => s.id === 'site-way-2')).toBe(false);

    h.sdk().worldView.showExisting(true);
    h.sdk().worldView.setGroundStyle('satellite');
    expect(h.sdk().worldView.getSite()).toMatchObject({ showRemoved: true, groundStyle: 'satellite' });

    expect(h.sdk().worldView.restoreBuilding('site-way-2')).toBe(true);
    expect(h.sdk().worldView.restoreBuilding('site-way-2')).toBe(false);
    expect(h.shapes.filter(s => s.type === 'site_building')).toHaveLength(2);

    expect(h.sdk().worldView.setBuildingHeight('site-way-1', 14)).toBe(true);
    expect(h.shapes.find(s => s.id === 'site-way-1')!.siteBuildingData).toMatchObject({ height: 14, heightSource: 'tagged' });
  });

  it('says so when a place can\'t be found', async () => {
    const h = harness();
    const findPlace = await import('../lib/worldSite/fetchSite');
    vi.spyOn(findPlace, 'findPlace').mockResolvedValue(null);
    await expect(h.sdk().worldView.importArea('Nowhere at all')).rejects.toThrow(/Couldn't find/);
    expect(h.shapes).toEqual([]);
  });
});
